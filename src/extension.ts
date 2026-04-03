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

    const create_top_level_folder: vscode.Disposable =
        vscode.commands.registerCommand(
            "extension.createTopLevelFolder",
            () => {
                vscode.window
                    .showInputBox({
                        prompt: "Folder Name",
                        value: "",
                    })
                    .then((name) => {
                        if (!name) {
                            return;
                        }

                        const parent = provider.model.rootFolder();
                        provider.model.createFolder(parent, name);

                        provider.refresh();
                    });
            },
        );
    context.subscriptions.push(create_top_level_folder);

    const create_folder: vscode.Disposable = vscode.commands.registerCommand(
        "extension.createFolder",
        (item: vscode.TreeItem) => {
            let folder_item: GladeFolderItem = item as GladeFolderItem;
            vscode.window
                .showInputBox({ prompt: "Folder Name" })
                .then((name) => {
                    if (!name) {
                        return;
                    }

                    const parent = folder_item.entry_id;
                    provider.model.createFolder(parent, name);

                    // TODO: expand parent on create.
                    provider.refresh();
                });
        },
    );
    context.subscriptions.push(create_folder);

    const remove_folder: vscode.Disposable = vscode.commands.registerCommand(
        "extension.removeFolder",
        (item: vscode.TreeItem) => {
            let folder_item: GladeFolderItem = item as GladeFolderItem;
            provider.model.remove(folder_item.entry_id);
            provider.refresh();
        },
    );
    context.subscriptions.push(remove_folder);

    const edit_folder_name: vscode.Disposable = vscode.commands.registerCommand(
        "extension.editFolderName",
        (item: vscode.TreeItem) => {
            let folder_item: GladeFolderItem = item as GladeFolderItem;
            vscode.window
                .showInputBox({
                    prompt: "Edit",
                    value: folder_item.name(),
                })
                .then((name) => {
                    if (name !== undefined) {
                        provider.model.setFolderName(
                            folder_item.entry_id,
                            name,
                        );
                        provider.refresh();
                    }
                });
        },
    );
    context.subscriptions.push(edit_folder_name);

    const edit_folder_color: vscode.Disposable =
        vscode.commands.registerCommand(
            "extension.pickFolderColor",
            (item: vscode.TreeItem) => {
                const folder_item: GladeFolderItem = item as GladeFolderItem;
                openColorPicker(provider, model, folder_item.entry_id);
            },
        );
    context.subscriptions.push(edit_folder_color);

    const track_file: vscode.Disposable = vscode.commands.registerCommand(
        "extension.trackFile",
        (item: vscode.TreeItem) => {
            const folder_item: GladeFolderItem = item as GladeFolderItem;
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const id = folder_item.entry_id;
                const uri = editor.document.uri;
                provider.model.createFile(id, uri);

                provider.refresh();
            } else {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
            }
        },
    );
    context.subscriptions.push(track_file);

    const track_file_top_level: vscode.Disposable =
        vscode.commands.registerCommand("extension.trackFileTopLevel", () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const root = provider.model.rootFolder();
                const uri = editor.document.uri;
                provider.model.createFile(root, uri);

                provider.refresh();
            } else {
                vscode.window.showErrorMessage(
                    "An editor must be open to track a file.",
                );
            }
        });
    context.subscriptions.push(track_file_top_level);

    const untrack_file: vscode.Disposable = vscode.commands.registerCommand(
        "extension.untrackFile",
        (item: vscode.TreeItem) => {
            const file_item: GladeFileItem = item as GladeFileItem;
            provider.model.remove(file_item.entry_id);
            provider.refresh();
        },
    );
    context.subscriptions.push(untrack_file);

    const open_file_in_editor: vscode.Disposable =
        vscode.commands.registerCommand(
            "extension.openFileInEditor",
            async (uri: vscode.Uri) => {
                const doc = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(doc);
            },
        );
    context.subscriptions.push(open_file_in_editor);
}

// TODO: open recursively.
// TODO: close recursively.
// TODO: drag-and-drop.

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
// Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

export class GladeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GladeFolderItem | null> =
        new vscode.EventEmitter<GladeFolderItem | null>();

    readonly onDidChangeTreeData: vscode.Event<GladeFolderItem | null> =
        this._onDidChangeTreeData.event;

    constructor(public model: GladeModel) {}

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(
        element?: GladeFolderItem,
    ): vscode.ProviderResult<vscode.TreeItem[]> {
        const id = !element ? this.model.rootFolder() : element.entry_id;
        if (this.model.isFolder(id)) {
            const children = this.model.folderChildren(id);
            return children.map((child) => {
                if (this.model.isFolder(child)) {
                    return new GladeFolderItem(
                        child,
                        this.model.folderName(child),
                        this.model.setFolderIconPath(child),
                    );
                } else {
                    // if (this.model.isFile(child))
                    return new GladeFileItem(child, this.model.fileUri(child));
                }
            });
        } else if (this.model.isFile(id)) {
            return [];
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
}

enum GladeItemType {
    File = "gladeFile",
    Folder = "gladeFolder",
}

class GladeFileItem extends vscode.TreeItem {
    constructor(
        public readonly entry_id: GladeId,
        uri: vscode.Uri,
    ) {
        super(uri, vscode.TreeItemCollapsibleState.None);
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

class GladeFolderItem extends vscode.TreeItem {
    constructor(
        public readonly entry_id: GladeId,
        name: string,
        icon_path: string,
    ) {
        super(name, vscode.TreeItemCollapsibleState.Collapsed);
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
    parent: GladeId;
    id: GladeId;

    constructor(parent: GladeId, id: GladeId) {
        this.parent = parent;
        this.id = id;
    }
}

class GladeFile extends GladeEntry {
    uri: vscode.Uri;

    constructor(parent: GladeId, id: GladeId, uri: vscode.Uri) {
        super(parent, id);
        this.uri = uri;
    }
}

class GladeFolder extends GladeEntry {
    name: string;
    color: vscode.Color;
    children: GladeId[];

    constructor(parent: GladeId, id: GladeId, name: string) {
        super(parent, id);

        this.name = name;
        this.color = new vscode.Color(1.0, 1.0, 1.0, 1.0);
        this.children = [];
    }
}

class GladeModel {
    private context: vscode.ExtensionContext;
    private iconManager: FolderIconManager;

    private entries: Record<GladeId, GladeEntry>;
    private root: GladeId;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.iconManager = new FolderIconManager(
            context.globalStorageUri.fsPath,
        );

        this.entries = {};

        const root_id = generateGladeId();
        this.root = root_id;
        this.entries[root_id] = new GladeFolder(root_id, root_id, "");
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
            const parent = entry.parent as GladeId;
            if (entry.children !== undefined) {
                let folder = new GladeFolder(parent, id, entry.name);
                folder.color = entry.color;
                folder.children = entry.children;
                this.entries[id] = folder;
            } else {
                let file = new GladeFile(parent, id, entry.uri);
                this.entries[id] = file;
            }
        }
        this.root = glade_state.root;
    }

    rootFolder(): GladeId {
        return this.root;
    }

    isFile(id: GladeId): boolean {
        return this.entries[id] instanceof GladeFile;
    }

    createFile(folder_id: GladeId, uri: vscode.Uri): void {
        const id = generateGladeId();

        let file = new GladeFile(folder_id, id, uri);
        this.entries[id] = file;

        let folder = this.folder(folder_id);
        folder.children.push(id);

        this.save();
    }

    fileUri(id: GladeId): vscode.Uri {
        const file = this.file(id);
        return file.uri;
    }

    isFolder(id: GladeId): boolean {
        return this.entries[id] instanceof GladeFolder;
    }

    createFolder(parent: GladeId, name: string): void {
        const id = generateGladeId();

        let folder = new GladeFolder(parent, id, name);
        this.entries[id] = folder;

        let parent_folder = this.folder(parent);
        parent_folder.children.push(id);

        this.save();
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
        if (id === this.root) return;

        // Check in the event that multiple removes were queued on the same entry.
        if (!(id in this.entries)) {
            return;
        }

        this.removeRecursive(id);

        this.save();
    }

    private removeRecursive(id: GladeId): void {
        let parent = this.parentOf(id);
        parent.children = parent.children.filter((child) => child !== id);

        if (this.isFolder(id)) {
            let folder = this.folder(id);
            for (let child of folder.children) {
                this.removeRecursive(child);
            }
        }

        delete this.entries[id];
    }

    private parentOf(id: GladeId): GladeFolder {
        const parent_id = this.entries[id].parent;
        return this.folder(parent_id);
    }

    private file(id: GladeId): GladeFile {
        return this.entries[id] as GladeFile;
    }

    private folder(id: GladeId): GladeFolder {
        return this.entries[id] as GladeFolder;
    }

    private async save() {
        await this.context.workspaceState.update("glade_state", {
            entries: this.entries,
            root: this.root,
        });
    }
}

// Don't look beyond this point...

class FolderIconManager {
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
