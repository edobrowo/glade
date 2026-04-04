import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";

export function activate(context: vscode.ExtensionContext) {
    // context.workspaceState.update("glade_state", undefined);

    const model = new GladeModel(context);
    model.load();

    const provider = new GladeProvider(model);

    const tree_view: vscode.TreeView<vscode.TreeItem> =
        vscode.window.createTreeView("gladeFileSystem", {
            treeDataProvider: provider,
        });
    context.subscriptions.push(tree_view);

    const create_top_level_folder = vscode.commands.registerCommand(
        "extension.createTopLevelFolder",
        async () => {
            const name = await vscode.window.showInputBox({
                prompt: "Folder Name",
                value: "",
            });
            if (!name) return;

            const parent_folder_id = provider.model.rootFolder();
            const result = provider.model.createFolder(parent_folder_id, name);
            if (!result) {
                vscode.window.showWarningMessage("Folder name in use.");
                return;
            }

            provider.refresh();
        },
    );
    context.subscriptions.push(create_top_level_folder);

    const create_folder = vscode.commands.registerCommand(
        "extension.createFolder",
        async (item: GladeFolderItem) => {
            const name = await vscode.window.showInputBox({
                prompt: "Folder Name",
            });
            if (!name) return;

            const parent_folder_id = item.gladeId;
            const result = provider.model.createFolder(parent_folder_id, name);
            if (!result) {
                vscode.window.showWarningMessage("Folder name in use.");
                return;
            }

            provider.refresh();

            // TODO: expand parent on create.
            // const parentItem = provider.createFolderItem(parent);
            // await tree_view.reveal(parentItem, { expand: true });
        },
    );
    context.subscriptions.push(create_folder);

    const remove_folder = vscode.commands.registerCommand(
        "extension.removeFolder",
        (item: GladeFolderItem) => {
            provider.model.remove(item.gladeId);
            provider.refresh();
        },
    );
    context.subscriptions.push(remove_folder);

    const edit_folder_name = vscode.commands.registerCommand(
        "extension.editFolderName",
        async (item: GladeFolderItem) => {
            const name = await vscode.window.showInputBox({
                prompt: "Edit",
                value: item.name(),
            });
            if (!name) return;

            provider.model.setFolderName(item.gladeId, name);

            provider.refresh();
        },
    );
    context.subscriptions.push(edit_folder_name);

    const edit_folder_color = vscode.commands.registerCommand(
        "extension.pickFolderColor",
        (item: GladeFolderItem) => {
            openColorPicker(provider, model, item.gladeId);
        },
    );
    context.subscriptions.push(edit_folder_color);

    const track_file = vscode.commands.registerCommand(
        "extension.trackFile",
        (item: GladeFolderItem) => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const id = item.gladeId;
                const uri = editor.document.uri;
                const result = provider.model.createFile(id, uri);
                if (!result) {
                    vscode.window.showWarningMessage(
                        "File already tracked in folder.",
                    );
                    return;
                }

                provider.refresh();
            } else {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
            }
        },
    );
    context.subscriptions.push(track_file);

    const track_file_top_level = vscode.commands.registerCommand(
        "extension.trackFileTopLevel",
        () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const root = provider.model.rootFolder();
                const uri = editor.document.uri;
                const result = provider.model.createFile(root, uri);
                if (!result) {
                    vscode.window.showWarningMessage(
                        "File already tracked in folder.",
                    );
                    return;
                }

                provider.refresh();
            } else {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
            }
        },
    );
    context.subscriptions.push(track_file_top_level);

    const untrack_file = vscode.commands.registerCommand(
        "extension.untrackFile",
        (item: GladeFileItem) => {
            provider.model.remove(item.gladeId);
            provider.refresh();
        },
    );
    context.subscriptions.push(untrack_file);

    const open_file_in_editor = vscode.commands.registerCommand(
        "extension.openFileInEditor",
        async (uri: vscode.Uri) => {
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);
        },
    );
    context.subscriptions.push(open_file_in_editor);
}

// TODO: drag-and-drop.
// TODO: open recursively.
// TODO: close recursively.

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
// Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

export class GladeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GladeFolderItem | null> =
        new vscode.EventEmitter<GladeFolderItem | null>();

    readonly onDidChangeTreeData: vscode.Event<GladeFolderItem | null> =
        this._onDidChangeTreeData.event;

    constructor(public model: GladeModel) {}

    getTreeItem(element: GladeItem): GladeItem {
        return element;
    }

    getChildren(
        element?: GladeFolderItem,
    ): vscode.ProviderResult<vscode.TreeItem[]> {
        const id = !element ? this.model.rootFolder() : element.gladeId;
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

    getParent(
        element: GladeFolderItem,
    ): vscode.ProviderResult<GladeFolderItem> {
        const parent_id = this.model.parentId(element.gladeId);
        return parent_id ? this.createFolderItem(parent_id) : null;
    }

    createFolderItem(id: GladeId): GladeFolderItem {
        return new GladeFolderItem(
            id,
            this.model.folderName(id),
            this.model.setFolderIconPath(id),
        );
    }

    createFileitem(id: GladeId): GladeFileItem {
        return new GladeFileItem(id, this.model.fileUri(id));
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
}

enum GladeItemType {
    File = "gladeFile",
    Folder = "gladeFolder",
}

class GladeItem extends vscode.TreeItem {
    public readonly gladeId: GladeId;

    constructor(
        glade_id: GladeId,
        label: string | vscode.Uri,
        collapsible_state?: vscode.TreeItemCollapsibleState,
    ) {
        if (label instanceof vscode.Uri) {
            super(label, vscode.TreeItemCollapsibleState.None);
        } else {
            super(label, collapsible_state);
        }

        this.gladeId = glade_id;
    }
}

class GladeFileItem extends GladeItem {
    constructor(glade_id: GladeId, uri: vscode.Uri) {
        super(glade_id, uri);

        this.contextValue = GladeItemType.File;

        this.resourceUri = uri;
        this.tooltip = uri.fsPath;

        this.command = {
            command: "vscode.open",
            title: "Open File",
            arguments: [uri],
        };
    }
}

class GladeFolderItem extends GladeItem {
    constructor(glade_id: GladeId, name: string, icon_path: string) {
        super(glade_id, name, vscode.TreeItemCollapsibleState.Collapsed);

        this.contextValue = GladeItemType.Folder;
        this.iconPath = icon_path;
    }

    name(): string {
        if (typeof this.label === "string") {
            return this.label;
        }
        return this.label?.label ?? "";
    }
}

type Brand<T, B> = T & { readonly __brand: B };

type GladeId = Brand<string, "GladeId">;

function generateGladeId(): GladeId {
    return crypto.randomUUID() as GladeId;
}

class GladeEntry {
    id: GladeId;
    parentId: GladeId | null;

    constructor(id: GladeId, parent_id: GladeId | null) {
        this.id = id;
        this.parentId = parent_id;
    }
}

class GladeFile extends GladeEntry {
    uri: vscode.Uri;

    constructor(id: GladeId, parent_id: GladeId | null, uri: vscode.Uri) {
        super(id, parent_id);
        this.uri = uri;
    }
}

class GladeFolder extends GladeEntry {
    name: string;
    color: vscode.Color;
    children: GladeId[];

    constructor(id: GladeId, parent_id: GladeId | null, name: string) {
        super(id, parent_id);

        this.name = name;
        this.color = new vscode.Color(1.0, 1.0, 1.0, 1.0);
        this.children = [];
    }
}

class GladeModel {
    private context: vscode.ExtensionContext;
    private iconManager: IconManager;

    private entries: Record<GladeId, GladeEntry>;
    private rootId: GladeId;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.iconManager = new IconManager(context.globalStorageUri.fsPath);

        this.entries = {};

        const root_id = generateGladeId();
        this.rootId = root_id;
        this.entries[root_id] = new GladeFolder(root_id, null, "");
    }

    load(): void {
        const glade_state = this.context.workspaceState.get<{
            entries: Record<GladeId, any>;
            root: GladeId;
        }>("glade_state");

        if (!glade_state) {
            return;
        }

        this.entries = {};
        for (const [entry_id, entry] of Object.entries(glade_state.entries)) {
            const id = entry_id as GladeId;
            const parent_id = entry.parent as GladeId;
            if (entry.children !== undefined) {
                let folder = new GladeFolder(id, parent_id, entry.name);
                folder.color = entry.color;
                folder.children = entry.children;
                this.entries[id] = folder;
            } else {
                // Recreate the URI because its loaded format differs from the construction format.
                const uri = entry.uri;
                const new_uri = vscode.Uri.from({
                    scheme: uri.scheme,
                    authority: uri.authority,
                    path: uri.path,
                    query: uri.query,
                    fragment: uri.fragment,
                });
                let file = new GladeFile(id, parent_id, new_uri);
                this.entries[id] = file;
            }
        }
        this.rootId = glade_state.root;
    }

    rootFolder(): GladeId {
        return this.rootId;
    }

    parentId(id: GladeId): GladeId | null {
        const parent = this.parentFolder(id);
        return parent ? parent.id : null;
    }

    isFile(id: GladeId): boolean {
        return this.entries[id] instanceof GladeFile;
    }

    createFile(folder_id: GladeId, uri: vscode.Uri): boolean {
        const is_uri_in_use = this.files(folder_id).some(
            (file) => file.uri.toString() === uri.toString(),
        );
        if (is_uri_in_use) {
            return false;
        }

        const id = generateGladeId();
        this.entries[id] = new GladeFile(id, folder_id, uri);

        let folder = this.folder(folder_id);
        folder.children.push(id);

        this.save();

        return true;
    }

    fileUri(id: GladeId): vscode.Uri {
        const file = this.file(id);
        return file.uri;
    }

    isFolder(id: GladeId): boolean {
        return this.entries[id] instanceof GladeFolder;
    }

    createFolder(parent_folder_id: GladeId, name: string): boolean {
        const is_name_in_use = this.subfolders(parent_folder_id).some(
            (folder) => folder.name === name,
        );
        if (is_name_in_use) {
            return false;
        }

        const id = generateGladeId();

        let folder = new GladeFolder(id, parent_folder_id, name);
        this.entries[id] = folder;

        let parent_folder = this.folder(parent_folder_id);
        parent_folder.children.push(id);

        this.save();

        return true;
    }

    folderName(id: GladeId): string {
        const folder = this.folder(id);
        return folder.name;
    }

    setFolderName(id: GladeId, name: string): void {
        let folder = this.folder(id);
        folder.name = name;
        this.save();
    }

    folderColor(id: GladeId): vscode.Color {
        const folder = this.folder(id);
        return folder.color;
    }

    setFolderColor(id: GladeId, color: vscode.Color): void {
        let folder = this.folder(id);
        folder.color = color;
        this.save();
    }

    setFolderIconPath(id: GladeId): string {
        const color = this.folderColor(id);
        this.iconManager.generate(color);
        return this.iconManager.pathOf(color);
    }

    folderChildren(id: GladeId): GladeId[] {
        const folder = this.folder(id);
        return folder.children;
    }

    remove(id: GladeId): void {
        if (id === this.rootId) return;

        // Check in the event that multiple removes were queued on the same entry.
        if (!(id in this.entries)) {
            return;
        }

        this.removeRecursive(id);

        this.save();
    }

    private removeRecursive(id: GladeId): void {
        let parent = this.parentFolder(id);
        if (parent) {
            parent.children = parent.children.filter(
                (child_id) => child_id !== id,
            );
        }

        if (this.isFolder(id)) {
            let folder = this.folder(id);
            for (let child_id of folder.children) {
                this.removeRecursive(child_id);
            }
        }

        delete this.entries[id];
    }

    private files(id: GladeId): GladeFile[] {
        const folder = this.folder(id);
        return folder.children
            .filter((child_id) => this.isFile(child_id))
            .map((child_id) => this.file(child_id));
    }

    private subfolders(id: GladeId): GladeFolder[] {
        const folder = this.folder(id);
        return folder.children
            .filter((child_id) => this.isFolder(child_id))
            .map((child_id) => this.folder(child_id));
    }

    private file(id: GladeId): GladeFile {
        return this.entries[id] as GladeFile;
    }

    private folder(id: GladeId): GladeFolder {
        return this.entries[id] as GladeFolder;
    }

    private parentFolder(id: GladeId): GladeFolder | null {
        const parent_id = this.entries[id].parentId;
        return parent_id != null ? this.folder(parent_id) : null;
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

        const file_path = path.join(this.basePath, this.createFileName(color));
        if (fs.existsSync(file_path)) {
            return file_path;
        }

        const svg = this.createSvg(color);
        await fs.promises.writeFile(file_path, svg);

        return file_path;
    }

    pathOf(color: vscode.Color): string {
        return path.join(this.basePath, this.createFileName(color));
    }

    private createFileName(color: vscode.Color): string {
        const name = new Rgb24Stringer(color).asName();
        return `glade-folder-color-${name}.svg`;
    }

    private createSvg(color: vscode.Color): string {
        const func = new Rgb24Stringer(color).asFunc();
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <rect x="25" y="25" width="50" height="50" rx="10" ry="10" fill="${func}"/>
            </svg>
        `;
    }
}

function openColorPicker(
    provider: GladeProvider,
    model: GladeModel,
    id: GladeId,
): void {
    const panel = vscode.window.createWebviewPanel(
        "gladeColorPicker",
        "Pick Folder Color",
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
        },
    );

    const initial_color = model.folderColor(id);
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

                model.setFolderColor(id, color);
                provider.refresh();

                panel.dispose();

                break;
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
    color: vscode.Color;

    constructor(color: vscode.Color) {
        this.color = color;
    }

    asFunc(): string {
        return `rgb(${this.decR()}, ${this.decG()}, ${this.decB()})`;
    }

    asName(): string {
        return `${this.decR()}-${this.decG()}-${this.decB()}`;
    }

    asHex(): string {
        return `#${this.hexR()}${this.hexG()}${this.hexB()}`;
    }

    private decR(): string {
        return this.dec(this.color.red);
    }

    private decG(): string {
        return this.dec(this.color.green);
    }

    private decB(): string {
        return this.dec(this.color.blue);
    }

    private hexR(): string {
        return this.hex(this.color.red);
    }

    private hexG(): string {
        return this.hex(this.color.green);
    }

    private hexB(): string {
        return this.hex(this.color.blue);
    }

    private dec(component: number): string {
        return (component * 255.0).toFixed(0);
    }

    private hex(component: number): string {
        return (component * 255.0).toString(16);
    }
}
