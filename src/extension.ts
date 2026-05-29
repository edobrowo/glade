import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";

export function activate(context: vscode.ExtensionContext): void {
    let model = Model.load(context);
    if (!model) model = Model.create(context);

    const provider = new Provider(model);

    const tree_view: vscode.TreeView<vscode.TreeItem> =
        vscode.window.createTreeView("gladeTrees", {
            treeDataProvider: provider,
            dragAndDropController: new DnDController(provider),
        });
    context.subscriptions.push(tree_view);

    provider.bindView(tree_view);

    tree_view.onDidExpandElement(async (event) => {
        const element = event.element as FolderTreeItem;
        await model.folderSetCollapsible(element.entryId, Collapsible.Expanded);
    });

    tree_view.onDidCollapseElement(async (event) => {
        const element = event.element as FolderTreeItem;
        await model.folderSetCollapsible(element.entryId, Collapsible.Collapsed);
    });

    // Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

    const top_level_track_file = vscode.commands.registerCommand(
        "extension.topLevelTrackFile",
        async (item: FolderTreeItem) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
                return;
            }

            const root_id = provider.rootFolder();
            const uri = editor.document.uri;
            await provider.trackFile(root_id, uri);
        },
    );
    context.subscriptions.push(top_level_track_file);

    const top_level_create_folder = vscode.commands.registerCommand(
        "extension.topLevelCreateFolder",
        async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Folder Name",
                value: "",
            });
            if (!name) return;

            const root_id = provider.rootFolder();
            await provider.createFolder(root_id, name);
        },
    );
    context.subscriptions.push(top_level_create_folder);

    const top_level_collapse_all = vscode.commands.registerCommand(
        "extension.topLevelCollapseAll",
        async () => {
            const root_id = provider.rootFolder();
            await provider.collapseAll(root_id);
        },
    );
    context.subscriptions.push(top_level_collapse_all);

    const create_folder = vscode.commands.registerCommand(
        "extension.createFolder",
        async (item: FolderTreeItem) => {
            const name = await vscode.window.showInputBox({
                prompt: "Folder Name",
            });
            if (!name) return;

            const parent_folder_id = item.entryId;
            await provider.createFolder(parent_folder_id, name);
        },
    );
    context.subscriptions.push(create_folder);

    const remove_folder = vscode.commands.registerCommand(
        "extension.removeFolder",
        async (item: FolderTreeItem) => {
            const folder_id = item.entryId;
            await provider.removeEntry(folder_id);
        },
    );
    context.subscriptions.push(remove_folder);

    const edit_folder_name = vscode.commands.registerCommand(
        "extension.editFolderName",
        async (item: FolderTreeItem) => {
            const name = await vscode.window.showInputBox({
                prompt: "Edit",
                value: item.name(),
            });
            if (!name) return;

            await provider.setFolderName(item.entryId, name);
        },
    );
    context.subscriptions.push(edit_folder_name);

    const edit_folder_color = vscode.commands.registerCommand(
        "extension.pickFolderColor",
        (item: FolderTreeItem) => {
            openColorPicker(provider, item);
        },
    );
    context.subscriptions.push(edit_folder_color);

    const track_file = vscode.commands.registerCommand(
        "extension.trackFile",
        async (item: FolderTreeItem) => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
                return;
            }

            const folder_id = item.entryId;
            const uri = editor.document.uri;
            await provider.trackFile(folder_id, uri);
        },
    );
    context.subscriptions.push(track_file);

    const untrack_file = vscode.commands.registerCommand(
        "extension.untrackFile",
        async (item: FileTreeItem) => await provider.removeEntry(item.entryId),
    );
    context.subscriptions.push(untrack_file);
}

// TODO: notes.
// TODO: better logo.

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
export class Provider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FolderTreeItem | null> =
        new vscode.EventEmitter<FolderTreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<FolderTreeItem | null> =
        this._onDidChangeTreeData.event;

    private model: Model;
    private treeView?: vscode.TreeView<vscode.TreeItem>;

    constructor(model: Model) {
        this.model = model;
    }

    getTreeItem(element: TreeItem): TreeItem {
        return element;
    }

    bindView(tree_view: vscode.TreeView<vscode.TreeItem>): void {
        this.treeView = tree_view;
    }

    getChildren(
        element?: FolderTreeItem,
    ): vscode.ProviderResult<vscode.TreeItem[]> {
        const id = !element ? this.model.root() : element.entryId;
        if (this.model.kind(id) == EntryKind.Folder) {
            const children = this.model.folderChildren(id);
            return children.map((child) => {
                if (this.model.kind(child) == EntryKind.Folder) {
                    return this.createFolderItem(child);
                } else {
                    return this.createFileItem(child);
                }
            });
        } else if (this.model.kind(id) == EntryKind.File) {
            return [];
        }
    }

    getParent(element: TreeItem): vscode.ProviderResult<FolderTreeItem> {
        const parent_id = this.model.parent(element.entryId);

        // The root is not an element, so all top-level elements must return
        // as null.
        if (!parent_id || parent_id === this.model.root()) {
            return null;
        }

        return this.createFolderItem(parent_id);
    }

    rootFolder(): EntryId {
        return this.model.root();
    }

    resolveTargetFolder(id: EntryId): EntryId {
        if (this.model.kind(id) == EntryKind.Folder) return id;
        const parent_id = this.model.parent(id);
        return parent_id || this.model.root();
    }

    async trackFile(folder_id: EntryId, uri: vscode.Uri): Promise<void> {
        const result = await this.model.fileCreate(folder_id, uri);
        if (!result) {
            vscode.window.showWarningMessage("File already tracked in folder.");
            return;
        }
        await this.model.folderSetCollapsible(folder_id, Collapsible.Expanded);

        this.refresh();

        this.expandFolder(folder_id);
    }

    async createFolder(parent_folder_id: EntryId, name: string): Promise<void> {
        const result = await this.model.folderCreate(parent_folder_id, name);
        if (!result) {
            vscode.window.showWarningMessage("Folder name in use.");
            return;
        }
        await this.model.folderSetCollapsible(
            parent_folder_id,
            Collapsible.Expanded,
        );

        this.refresh();

        this.expandFolder(parent_folder_id);
    }

    async moveEntry(id: EntryId, target_folder_id: EntryId): Promise<void> {
        const old_parent_id = this.model.parent(id);

        const result = await this.model.move(id, target_folder_id);
        if (!result) {
            vscode.window.showWarningMessage(
                "Entry already exists in target folder.",
            );
            return;
        }

        if (old_parent_id) {
            await this.model.folderSetCollapsible(
                target_folder_id,
                Collapsible.Expanded,
            );

            const is_empty = this.model.folderIsEmpty(old_parent_id);
            if (is_empty) {
                await this.model.folderSetCollapsible(
                    old_parent_id,
                    Collapsible.None,
                );
            }
        }

        this.refresh();

        this.expandFolder(target_folder_id);
    }

    async removeEntry(id: EntryId): Promise<void> {
        const folder_id = this.model.parent(id);

        await this.model.remove(id);

        if (!folder_id) {
            this.refresh();
            return;
        }

        const is_empty = this.model.folderIsEmpty(folder_id);
        if (is_empty) {
            await this.model.folderSetCollapsible(folder_id, Collapsible.None);
        }

        this.refresh();
    }

    async setFolderName(folder_id: EntryId, name: string): Promise<void> {
        await this.model.folderSetName(folder_id, name);

        this.refresh();
    }

    folderColor(folder_id: EntryId): vscode.Color {
        return this.model.folderColor(folder_id);
    }

    async setFolderColor(
        folder_id: EntryId,
        color: vscode.Color,
    ): Promise<void> {
        await this.model.folderSetColor(folder_id, color);

        this.refresh();
    }

    async collapseAll(top_folder_id: EntryId): Promise<void> {
        await vscode.commands.executeCommand(
            "workbench.actions.treeView.gladeTrees.collapseAll",
        );

        const descendents = this.model.descendents(top_folder_id);

        const folders_to_collapse = [top_folder_id, ...descendents].filter(
            (id) => this.model.kind(id) == EntryKind.Folder,
        );

        for (const id of folders_to_collapse) {
            if (this.model.folderCollapsible(id) !== Collapsible.Expanded)
                continue;
            await this.model.folderSetCollapsible(id, Collapsible.Collapsed);
        }

        this.refresh();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }

    createFolderItem(id: EntryId): FolderTreeItem {
        return new FolderTreeItem(
            id,
            this.model.folderName(id),
            this.model.folderIconPath(id),
            this.convertCollapsible(this.model.folderCollapsible(id)),
        );
    }

    createFileItem(id: EntryId): FileTreeItem {
        return new FileTreeItem(id, this.model.fileUri(id));
    }

    private async expandFolder(folder_id: EntryId): Promise<void> {
        if (!this.treeView) return;

        const folder_item = this.createFolderItem(folder_id);
        try {
            await this.treeView.reveal(folder_item, {
                expand: true,
                select: false,
                focus: false,
            });
        } catch (error) {
            console.error("Failed to expand folder in TreeView", error);
        }
    }

    private convertCollapsible(
        collapsible: Collapsible,
    ): vscode.TreeItemCollapsibleState {
        switch (collapsible) {
            case Collapsible.None:
                return vscode.TreeItemCollapsibleState.None;
            case Collapsible.Collapsed:
                return vscode.TreeItemCollapsibleState.Collapsed;
            case Collapsible.Expanded:
                return vscode.TreeItemCollapsibleState.Expanded;
        }
    }
}

class DnDController implements vscode.TreeDragAndDropController<TreeItem> {
    dropMimeTypes: readonly string[] = [
        "application/vnd.code.tree.glade",
        "text/uri-list",
    ];

    dragMimeTypes: readonly string[] = ["application/vnd.code.tree.glade"];

    constructor(private provider: Provider) {}

    async handleDrag(
        source: readonly TreeItem[],
        data_transfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        data_transfer.set(
            "application/vnd.code.tree.glade",
            new vscode.DataTransferItem(source.map((item) => item.entryId)),
        );
    }

    async handleDrop(
        target: TreeItem | undefined,
        data_transfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        const target_folder_id = target
            ? this.provider.resolveTargetFolder(target.entryId)
            : this.provider.rootFolder();

        const tree_dti = data_transfer.get("application/vnd.code.tree.glade");
        if (tree_dti) {
            const id_list = tree_dti.value;

            for (const id of id_list) {
                this.provider.moveEntry(id, target_folder_id);
            }

            return;
        }

        const tab_dti = data_transfer.get("text/uri-list");
        if (tab_dti) {
            const uri = vscode.Uri.parse(tab_dti.value);
            if (!uri) {
                vscode.window.showWarningMessage("Invalid URI");
                return;
            }

            await this.provider.trackFile(target_folder_id, uri);
        }
    }
}

enum ItemType {
    File = "gladeFile",
    Folder = "gladeFolder",
}

class TreeItem extends vscode.TreeItem {
    public readonly entryId: EntryId;

    constructor(
        entry_id: EntryId,
        label: string | vscode.Uri,
        collapsible_state?: vscode.TreeItemCollapsibleState,
    ) {
        if (label instanceof vscode.Uri) {
            super(label, vscode.TreeItemCollapsibleState.None);
        } else {
            super(label, collapsible_state);
        }

        this.entryId = entry_id;

        // Cache-busting shenanigans. Each pair of entry and expansion state
        // needs its own unique entry in order for auto-expansion to function
        // properly.
        this.id =
            collapsible_state !== undefined
                ? `${entry_id}-${collapsible_state}`
                : (entry_id as string);
    }
}

class FileTreeItem extends TreeItem {
    constructor(entry_id: EntryId, uri: vscode.Uri) {
        super(entry_id, uri);

        this.contextValue = ItemType.File;

        this.resourceUri = uri;
        this.tooltip = uri.fsPath;

        this.command = {
            command: "vscode.open",
            title: "Open File",
            arguments: [uri],
        };
    }
}

class FolderTreeItem extends TreeItem {
    constructor(
        entry_id: EntryId,
        name: string,
        icon_path: string,
        collapsible: vscode.TreeItemCollapsibleState,
    ) {
        super(entry_id, name, collapsible);

        this.contextValue = ItemType.Folder;
        this.iconPath = icon_path;
    }

    name(): string {
        return typeof this.label === "string"
            ? this.label
            : (this.label?.label ?? "");
    }
}

type Brand<T, B> = T & { readonly __brand: B };

type EntryId = Brand<string, "EntryId">;

function generateGladeId(): EntryId {
    return crypto.randomUUID() as EntryId;
}

enum Collapsible {
    None = "none",
    Collapsed = "collapsed",
    Expanded = "expanded",
}

enum EntryKind {
    File = "file",
    Folder = "folder",
}

class BaseEntry {
    readonly kind: EntryKind;
    readonly id: EntryId;
    parentId: EntryId | null;

    constructor(kind: EntryKind, id: EntryId, parent_id: EntryId | null) {
        this.kind = kind;
        this.id = id;
        this.parentId = parent_id;
    }
}

class FileEntry extends BaseEntry {
    readonly uri: vscode.Uri;

    constructor(id: EntryId, parent_id: EntryId, uri: vscode.Uri) {
        super(EntryKind.File, id, parent_id);

        // Reset the URI since its format can change after deserialization.
        this.uri = vscode.Uri.from({
            scheme: uri.scheme,
            authority: uri.authority,
            path: uri.path,
            query: uri.query,
            fragment: uri.fragment,
        });
    }
}

class FolderEntry extends BaseEntry {
    children: EntryId[] = [];

    name: string;
    color: vscode.Color = new vscode.Color(1.0, 1.0, 1.0, 1.0);
    collapsible: Collapsible = Collapsible.None;

    constructor(id: EntryId, parent_id: EntryId | null, name: string) {
        super(EntryKind.Folder, id, parent_id);
        this.name = name;
    }
}

type Entry = FileEntry | FolderEntry;

class Model {
    private context: vscode.ExtensionContext;
    private iconManager: IconManager;

    private entries: Record<EntryId, Entry>;
    private rootId: EntryId;

    static load(context: vscode.ExtensionContext): Model | null {
        const glade_state = context.workspaceState.get<{
            entries: Record<EntryId, any>;
            root: EntryId;
        }>("glade_state");
        if (!glade_state) return null;

        let model = new Model(context, glade_state.root);

        for (const [entry_id, entry] of Object.entries(glade_state.entries)) {
            const id = entry_id as EntryId;
            const parent_id = entry.parentId as EntryId;
            const kind = entry.kind;

            switch (kind) {
                case EntryKind.File: {
                    const file = new FileEntry(id, parent_id, entry.uri);

                    model.entries[id] = file;

                    break;
                }
                case EntryKind.Folder: {
                    const folder = new FolderEntry(id, parent_id, entry.name);
                    folder.children = entry.children;
                    folder.color = entry.color;
                    folder.collapsible = entry.collapsible;

                    model.entries[id] = folder;

                    break;
                }
            }
        }

        return model;
    }

    static create(context: vscode.ExtensionContext): Model {
        const root_id = generateGladeId();
        return new Model(context, root_id);
    }

    private constructor(context: vscode.ExtensionContext, root_id: EntryId) {
        this.context = context;
        this.iconManager = new IconManager(context.globalStorageUri.fsPath);

        this.entries = {};
        this.rootId = root_id;

        this.entries[this.rootId] = new FolderEntry(this.rootId, null, "");
    }

    root(): EntryId {
        return this.rootId;
    }

    kind(id: EntryId): EntryKind {
        return this.entry(id).kind;
    }

    parent(id: EntryId): EntryId | null {
        return this.entry(id).parentId;
    }

    descendents(id: EntryId): EntryId[] {
        const descendents_recursive = (id: EntryId): EntryId[] => {
            switch (this.kind(id)) {
                case EntryKind.File: {
                    return [];
                }
                case EntryKind.Folder: {
                    return this.folderChildren(id).flatMap((child_id) => [
                        child_id,
                        ...descendents_recursive(child_id),
                    ]);
                }
            }
        };

        return descendents_recursive(id);
    }

    isUriInFolder(uri: vscode.Uri, folder_id: EntryId): boolean {
        return this.folderFileEntries(folder_id).some(
            (entry) => entry.uri.toString() === uri.toString(),
        );
    }

    isSubfolderNameInFolder(name: string, folder_id: EntryId): boolean {
        return this.folderSubfolderEntries(folder_id).some(
            (entry) => entry.name === name,
        );
    }

    isMovableTo(id: EntryId, folder_id: EntryId): boolean {
        switch (this.kind(id)) {
            case EntryKind.File: {
                return !this.isUriInFolder(this.fileUri(id), folder_id);
            }
            case EntryKind.Folder: {
                return !this.isSubfolderNameInFolder(
                    this.folderName(id),
                    folder_id,
                );
            }
        }
    }

    async move(id: EntryId, folder_id: EntryId): Promise<boolean> {
        if (!this.isMovableTo(id, folder_id)) return false;

        const parent_id = this.parent(id);
        if (parent_id) this.removeSubentry(parent_id, id);

        const new_parent_folder = this.tryFolderEntry(folder_id);
        new_parent_folder.children.push(id);

        let entry = this.entry(id);
        entry.parentId = new_parent_folder.id;

        await this.save();

        return true;
    }

    async remove(id: EntryId): Promise<void> {
        if (id === this.rootId) return;

        // Check in case multiple removes were queued on the same entry.
        if (!(id in this.entries)) return;

        const remove_recursive = (id: EntryId): void => {
            const parent_id = this.parent(id);
            if (parent_id) this.removeSubentry(parent_id, id);

            switch (this.kind(id)) {
                case EntryKind.File:
                    break;
                case EntryKind.Folder: {
                    for (let child_id of this.folderChildren(id)) {
                        remove_recursive(child_id);
                    }

                    break;
                }
            }

            delete this.entries[id];
        };

        remove_recursive(id);

        await this.save();
    }

    async fileCreate(folder_id: EntryId, uri: vscode.Uri): Promise<boolean> {
        if (this.isUriInFolder(uri, folder_id)) return false;

        const id = generateGladeId();

        this.entries[id] = new FileEntry(id, folder_id, uri);
        this.pushSubentry(folder_id, id);

        await this.save();

        return true;
    }

    fileUri(id: EntryId): vscode.Uri {
        const file = this.tryFileEntry(id);
        return file.uri;
    }

    async folderCreate(
        parent_folder_id: EntryId,
        name: string,
    ): Promise<boolean> {
        if (this.isSubfolderNameInFolder(name, parent_folder_id)) return false;

        const id = generateGladeId();

        this.entries[id] = new FolderEntry(id, parent_folder_id, name);
        this.pushSubentry(parent_folder_id, id);

        await this.save();

        return true;
    }

    folderChildren(id: EntryId): readonly EntryId[] {
        const folder = this.tryFolderEntry(id);
        return folder.children;
    }

    folderIsEmpty(id: EntryId): boolean {
        return this.folderChildren(id).length === 0;
    }

    folderName(id: EntryId): string {
        const folder = this.tryFolderEntry(id);
        return folder.name;
    }

    async folderSetName(id: EntryId, name: string): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.name = name;

        await this.save();
    }

    folderColor(id: EntryId): vscode.Color {
        const folder = this.tryFolderEntry(id);
        return folder.color;
    }

    async folderSetColor(id: EntryId, color: vscode.Color): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.color = color;

        await this.save();
    }

    folderIconPath(id: EntryId): string {
        const color = this.folderColor(id);
        this.iconManager.generate(color);
        return this.iconManager.colorIndicatorFilePath(color);
    }

    folderCollapsible(id: EntryId): Collapsible {
        let folder = this.tryFolderEntry(id);
        return folder.collapsible;
    }

    async folderSetCollapsible(
        id: EntryId,
        collapsible: Collapsible,
    ): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.collapsible = collapsible;

        await this.save();
    }

    private entry(id: EntryId): Entry {
        return this.entries[id];
    }

    private tryFileEntry(id: EntryId): FileEntry {
        if (this.kind(id) !== EntryKind.File) {
            throw new Error("Entry is not a folder");
        }
        return this.entry(id) as FileEntry;
    }

    private tryFolderEntry(id: EntryId): FolderEntry {
        if (this.kind(id) !== EntryKind.Folder) {
            throw new Error("Entry is not a folder");
        }
        return this.entry(id) as FolderEntry;
    }

    private folderFileEntries(id: EntryId): FileEntry[] {
        const folder = this.tryFolderEntry(id);
        return folder.children
            .filter((child_id) => this.kind(child_id) == EntryKind.File)
            .map((child_id) => this.tryFileEntry(child_id));
    }

    private folderSubfolderEntries(id: EntryId): FolderEntry[] {
        const folder = this.tryFolderEntry(id);
        return folder.children
            .filter((child_id) => this.kind(child_id) === EntryKind.Folder)
            .map((child_id) => this.tryFolderEntry(child_id));
    }

    private pushSubentry(parent_id: EntryId, id: EntryId): void {
        const parent_folder = this.tryFolderEntry(parent_id);
        if (parent_folder) {
            parent_folder.children.push(id);
        }
    }

    private removeSubentry(parent_id: EntryId, id: EntryId): void {
        const parent_folder = this.tryFolderEntry(parent_id);
        if (parent_folder) {
            parent_folder.children = parent_folder.children.filter(
                (child_id) => child_id !== id,
            );
        }
    }

    private async save() {
        await this.context.workspaceState.update("glade_state", {
            entries: this.entries,
            root: this.rootId,
        });
    }
}

// Nothing to see here...

class IconManager {
    private basePath: string;

    constructor(base_path: string) {
        this.basePath = base_path;
    }

    async generate(color: vscode.Color): Promise<string> {
        if (!fs.existsSync(this.basePath)) {
            await fs.promises.mkdir(this.basePath, {
                recursive: true,
            });
        }

        const file_path = path.join(
            this.basePath,
            this.createColorIndicatorFileName(color),
        );
        if (fs.existsSync(file_path)) return file_path;

        const svg = this.createColorIndicatorSvg(color);
        await fs.promises.writeFile(file_path, svg);

        return file_path;
    }

    colorIndicatorFilePath(color: vscode.Color): string {
        return path.join(
            this.basePath,
            this.createColorIndicatorFileName(color),
        );
    }

    private createColorIndicatorFileName(color: vscode.Color): string {
        const name = new Rgb24Stringer(color).asName();
        return `glade-folder-color-${name}.svg`;
    }

    private createColorIndicatorSvg(color: vscode.Color): string {
        const rgb_function = new Rgb24Stringer(color).asFunction();
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <rect x="25" y="25" width="50" height="50" rx="10" ry="10" fill="${rgb_function}"/>
            </svg>
        `;
    }
}

function openColorPicker(provider: Provider, item: FolderTreeItem): void {
    const panel = vscode.window.createWebviewPanel(
        "gladeColorPicker",
        "Pick Folder Color",
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
        },
    );

    const initial_color = provider.folderColor(item.entryId);
    panel.webview.html = colorPickerContent(initial_color);

    panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.type) {
            case "colorSelected":
                const color = new vscode.Color(
                    message.value.r / 255.0,
                    message.value.g / 255.0,
                    message.value.b / 255.0,
                    1.0,
                );

                provider.setFolderColor(item.entryId, color);

                panel.dispose();
                return;
        }
    });
}

// Source: https://iro.js.org
function colorPickerContent(color: vscode.Color): string {
    return `
<!DOCTYPE html>
<html>
<body>
    <main>
        <div id="picker"></div>
        <button id="accept-pick">Accept</button>
    </main>

    <script src="https://cdn.jsdelivr.net/npm/@jaames/iro@5"></script>
    <script>
        const vscode = acquireVsCodeApi();

        const picker = new iro.ColorPicker("#picker", {
            layout: [
                { component: iro.ui.Wheel },
                { component: iro.ui.Slider, options: { sliderType: 'saturation' } },
                { component: iro.ui.Slider, options: { sliderType: 'value' } },
            ],
            width: 240,
            color: {
                r: ${Math.round(color.red * 255.0)},
                g: ${Math.round(color.green * 255.0)},
                b: ${Math.round(color.blue * 255.0)}
            }
        });

        let current_color = picker.color.rgb;
        picker.on("color:change", (color) => {
            current_color = color.rgb;
        });

        const button = document.getElementById("accept-pick");

        window.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                vscode.postMessage({
                    type: "colorSelected",
                    value: current_color
                });
            }
        });

        button.addEventListener("click", () => {
            vscode.postMessage({
                type: "colorSelected",
                value: current_color
            });
        });
    </script>
    <style>
        main {
            display: flex;
            flex-direction: column;
            justify-content: left;
            gap: 20px;
            padding: 32px;
        }

        #accept-pick {
            width: 240px;
            height: 24px;
            border: none;
            border-radius: 4px;
            background-color: #3B63CE;
            color: #FFFFFF;
            font-family: system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;;
        }

        #accept-pick:hover {
            background-color: #3D6FE0;
        }
    </style>
</body>
</html>
`;
}

class Rgb24Stringer {
    constructor(private readonly color: vscode.Color) {}

    asFunction(): string {
        return `rgb(${this.red()}, ${this.green()}, ${this.blue()})`;
    }

    asName(): string {
        return `${this.red()}-${this.green()}-${this.blue()}`;
    }

    private red(): string {
        return this.component(this.color.red);
    }

    private green(): string {
        return this.component(this.color.green);
    }

    private blue(): string {
        return this.component(this.color.blue);
    }

    private component(component: number): string {
        return (component * 255.0).toFixed(0);
    }
}
