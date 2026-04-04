import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";

export function activate(context: vscode.ExtensionContext): void {
    context.workspaceState.update("glade_state", undefined);

    let model = Model.load(context);
    if (!model) model = Model.create(context);

    const provider = new Provider(model);

    const tree_view: vscode.TreeView<vscode.TreeItem> =
        vscode.window.createTreeView("gladeTrees", {
            treeDataProvider: provider,
        });
    context.subscriptions.push(tree_view);

    tree_view.onDidExpandElement((event) => {
        const element = event.element as FolderTreeItem;
        model.folderSetCollapsible(element.entryId, Collapsible.Expanded);
    });

    tree_view.onDidCollapseElement((event) => {
        const element = event.element as FolderTreeItem;
        model.folderSetCollapsible(element.entryId, Collapsible.Collapsed);
    });

    // Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

    const top_level_track_file = vscode.commands.registerCommand(
        "extension.topLevelTrackFile",
        () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
                return;
            }

            const root = provider.model.root();
            const uri = editor.document.uri;
            const result = provider.model.fileCreate(root, uri);
            if (!result) {
                vscode.window.showWarningMessage(
                    "File already tracked in folder.",
                );
                return;
            }

            provider.refresh();
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

            const parent_folder_id = provider.model.root();
            const result = provider.model.folderCreate(parent_folder_id, name);
            if (!result) {
                vscode.window.showWarningMessage("Folder name in use.");
                return;
            }

            provider.refresh();
        },
    );
    context.subscriptions.push(top_level_create_folder);

    const top_level_collapse_all = vscode.commands.registerCommand(
        "extension.topLevelCollapseAll",
        async () => {
            const root_id = provider.model.root();
            const descendents = provider.model.descendents(root_id);
            const folder_descendents = descendents.filter((id) =>
                provider.model.isFolder(id),
            );
            for (const id of folder_descendents) {
                if (
                    provider.model.folderCollapsible(id) !==
                    Collapsible.Expanded
                )
                    continue;
                provider.model.folderSetCollapsible(id, Collapsible.Collapsed);
            }

            provider.refresh();

            // TODO: broken.
            // for (const id of folder_descendents.toReversed()) {
            //     const folder_item = provider.createFolderItem(id);
            //     await tree_view.reveal(folder_item, { expand: false });
            // }
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
            const result = provider.model.folderCreate(parent_folder_id, name);
            if (!result) {
                vscode.window.showWarningMessage("Folder name in use.");
                return;
            }

            provider.model.folderSetCollapsible(
                parent_folder_id,
                Collapsible.Expanded,
            );

            provider.refresh();

            // FIXME: Hack to reveal the folder. The collapsible state can be set to None or Collapsed, but not Expanded.
            // FIXME: Folders do not expand on first workspace load.
            const parent_folder_item =
                provider.createFolderItem(parent_folder_id);
            await tree_view.reveal(parent_folder_item, { expand: true });
        },
    );
    context.subscriptions.push(create_folder);

    const remove_folder = vscode.commands.registerCommand(
        "extension.removeFolder",
        async (item: FolderTreeItem) => {
            const folder_id = item.entryId;

            provider.model.remove(folder_id);
            const is_empty = provider.model.folderIsEmpty(folder_id);
            if (is_empty) {
                provider.model.folderSetCollapsible(
                    folder_id,
                    Collapsible.None,
                );
            }

            provider.refresh();
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

            provider.model.folderSetName(item.entryId, name);

            provider.refresh();
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
            const result = provider.model.fileCreate(folder_id, uri);
            if (!result) {
                vscode.window.showWarningMessage(
                    "File already tracked in folder.",
                );
                return;
            }

            provider.model.folderSetCollapsible(
                folder_id,
                Collapsible.Expanded,
            );

            provider.refresh();

            // FIXME: Hack to reveal the folder. The collapsible state can be set to None or Collapsed, but not Expanded.
            // FIXME: Folders do not expand on first workspace load.
            const folder_item = provider.createFolderItem(folder_id);
            await tree_view.reveal(folder_item, { expand: true });
        },
    );
    context.subscriptions.push(track_file);

    const untrack_file = vscode.commands.registerCommand(
        "extension.untrackFile",
        (item: FileTreeItem) => {
            provider.model.remove(item.entryId);

            provider.refresh();
        },
    );
    context.subscriptions.push(untrack_file);
}

// TODO: drag-and-drop.
// TODO: open recursively.
// TODO: close recursively.

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
export class Provider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<FolderTreeItem | null> =
        new vscode.EventEmitter<FolderTreeItem | null>();
    readonly onDidChangeTreeData: vscode.Event<FolderTreeItem | null> =
        this._onDidChangeTreeData.event;

    public model: Model;

    constructor(model: Model) {
        this.model = model;
    }

    getTreeItem(element: TreeItem): TreeItem {
        return element;
    }

    getChildren(
        element?: FolderTreeItem,
    ): vscode.ProviderResult<vscode.TreeItem[]> {
        const id = !element ? this.model.root() : element.entryId;
        if (this.model.isFolder(id)) {
            const children = this.model.folderChildren(id);
            return children.map((child) => {
                if (this.model.isFolder(child)) {
                    return this.createFolderItem(child);
                } else {
                    return this.createFileitem(child);
                }
            });
        } else if (this.model.isFile(id)) {
            return [];
        }
    }

    getParent(element: TreeItem): vscode.ProviderResult<FolderTreeItem> {
        const parent_id = this.model.parent(element.entryId);
        return parent_id ? this.createFolderItem(parent_id) : null;
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

    createFileitem(id: EntryId): FileTreeItem {
        return new FileTreeItem(id, this.model.fileUri(id));
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
    None = 0,
    Collapsed = 1,
    Expanded = 2,
}

class Entry {
    readonly id: EntryId;
    readonly parentId: EntryId | null;

    constructor(id: EntryId, parent_id: EntryId | null) {
        this.id = id;
        this.parentId = parent_id;
    }
}

class File extends Entry {
    readonly uri: vscode.Uri;

    constructor(id: EntryId, parent_id: EntryId, uri: vscode.Uri) {
        super(id, parent_id);
        this.uri = uri;
    }
}

class Folder extends Entry {
    children: EntryId[] = [];

    name: string;
    color: vscode.Color = new vscode.Color(1.0, 1.0, 1.0, 1.0);
    collapsible: Collapsible = Collapsible.None;

    constructor(id: EntryId, parent_id: EntryId | null, name: string) {
        super(id, parent_id);
        this.name = name;
    }
}

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
            const parent_id = entry.parent as EntryId;

            if (entry.children !== undefined) {
                let folder = new Folder(id, parent_id, entry.name);
                folder.color = entry.color;
                folder.children = entry.children;
                folder.collapsible = entry.collapsible;

                model.entries[id] = folder;
            } else {
                // Recreate the URI because its loaded format differs from the construction format.
                const uri = vscode.Uri.from({
                    scheme: entry.uri.scheme,
                    authority: entry.uri.authority,
                    path: entry.uri.path,
                    query: entry.uri.query,
                    fragment: entry.uri.fragment,
                });

                model.entries[id] = new File(id, parent_id, uri);
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

        this.entries[this.rootId] = new Folder(this.rootId, null, "");
    }

    root(): EntryId {
        return this.rootId;
    }

    parent(id: EntryId): EntryId | null {
        return this.entries[id].parentId;
    }

    descendents(id: EntryId): EntryId[] {
        if (this.isFile(id)) return [];

        const descendents_recursive = (id: EntryId): EntryId[] => {
            if (this.isFolder(id)) {
                return this.folderChildren(id).flatMap((child_id) => [
                    child_id,
                    ...descendents_recursive(child_id),
                ]);
            } else {
                return [];
            }
        };

        return descendents_recursive(id);
    }

    remove(id: EntryId): void {
        if (id === this.rootId) return;

        // Check in case multiple removes were queued on the same entry.
        if (!(id in this.entries)) return;

        const remove_recursive = (id: EntryId): void => {
            let parent_folder = this.folderParentEntry(id);
            if (parent_folder) {
                parent_folder.children = parent_folder.children.filter(
                    (child_id) => child_id !== id,
                );
            }

            if (this.isFolder(id)) {
                let folder = this.folderEntry(id);
                for (let child_id of folder.children) {
                    remove_recursive(child_id);
                }
            }

            delete this.entries[id];
        };

        remove_recursive(id);

        this.save();
    }

    isFile(id: EntryId): boolean {
        return this.entries[id] instanceof File;
    }

    isFolder(id: EntryId): boolean {
        return this.entries[id] instanceof Folder;
    }

    fileCreate(folder_id: EntryId, uri: vscode.Uri): boolean {
        const is_uri_in_use = this.folderFileEntries(folder_id).some(
            (file) => file.uri.toString() === uri.toString(),
        );
        if (is_uri_in_use) return false;

        const id = generateGladeId();
        this.entries[id] = new File(id, folder_id, uri);

        let folder = this.folderEntry(folder_id);
        folder.children.push(id);

        this.save();

        return true;
    }

    fileUri(id: EntryId): vscode.Uri {
        const file = this.fileEntry(id);
        return file.uri;
    }

    folderCreate(parent_folder_id: EntryId, name: string): boolean {
        const is_name_in_use = this.folderSubfolderEntries(
            parent_folder_id,
        ).some((folder) => folder.name === name);
        if (is_name_in_use) return false;

        const id = generateGladeId();

        let folder = new Folder(id, parent_folder_id, name);
        this.entries[id] = folder;

        let parent_folder = this.folderEntry(parent_folder_id);
        parent_folder.children.push(id);

        this.save();

        return true;
    }

    folderChildren(id: EntryId): EntryId[] {
        const folder = this.folderEntry(id);
        return folder.children;
    }

    folderIsEmpty(id: EntryId): boolean {
        return this.folderChildren(id).length === 0;
    }

    folderName(id: EntryId): string {
        const folder = this.folderEntry(id);
        return folder.name;
    }

    folderSetName(id: EntryId, name: string): void {
        let folder = this.folderEntry(id);
        folder.name = name;
        this.save();
    }

    folderColor(id: EntryId): vscode.Color {
        const folder = this.folderEntry(id);
        return folder.color;
    }

    folderSetColor(id: EntryId, color: vscode.Color): void {
        let folder = this.folderEntry(id);
        folder.color = color;
        this.save();
    }

    folderIconPath(id: EntryId): string {
        const color = this.folderColor(id);
        this.iconManager.generate(color);
        return this.iconManager.colorIndicatorFilePath(color);
    }

    folderCollapsible(id: EntryId): Collapsible {
        let folder = this.folderEntry(id);
        return folder.collapsible;
    }

    folderSetCollapsible(id: EntryId, collapsible: Collapsible): void {
        let folder = this.folderEntry(id);
        folder.collapsible = collapsible;
        this.save();
    }

    private fileEntry(id: EntryId): File {
        return this.entries[id] as File;
    }

    private folderEntry(id: EntryId): Folder {
        return this.entries[id] as Folder;
    }

    private folderFileEntries(id: EntryId): File[] {
        const folder = this.folderEntry(id);
        return folder.children
            .filter((child_id) => this.isFile(child_id))
            .map((child_id) => this.fileEntry(child_id));
    }

    private folderSubfolderEntries(id: EntryId): Folder[] {
        const folder = this.folderEntry(id);
        return folder.children
            .filter((child_id) => this.isFolder(child_id))
            .map((child_id) => this.folderEntry(child_id));
    }

    private folderParentEntry(id: EntryId): Folder | null {
        const parent_id = this.parent(id);
        return parent_id ? this.folderEntry(parent_id) : null;
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

    const initial_color = provider.model.folderColor(item.entryId);
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

                provider.model.folderSetColor(item.entryId, color);

                provider.refresh();

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
