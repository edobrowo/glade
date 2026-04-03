import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";

export function activate(context: vscode.ExtensionContext) {
    const model = new GladeModel(context);
    model.load();

    const provider = new GladeProvider(model);

    const tree_view: vscode.TreeView<GladeFolderItem> =
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
                    .then((new_value) => {
                        if (!new_value) {
                            return;
                        }
                        const parent = provider.model.rootFolder();
                        provider.model.createFolder(parent, new_value);
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
                .then((new_value) => {
                    if (!new_value) {
                        return;
                    }
                    const parent = folder_item.entry_id;
                    provider.model.createFolder(parent, new_value);
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
                .then((new_value) => {
                    if (new_value !== undefined) {
                        provider.model.setName(folder_item.entry_id, new_value);
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
                let folder_item: GladeFolderItem = item as GladeFolderItem;
                openColorPicker(provider, model, folder_item.entry_id);
            },
        );
    context.subscriptions.push(edit_folder_color);
}

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
// Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

export class GladeProvider implements vscode.TreeDataProvider<GladeFolderItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GladeFolderItem | null> =
        new vscode.EventEmitter<GladeFolderItem | null>();

    readonly onDidChangeTreeData: vscode.Event<GladeFolderItem | null> =
        this._onDidChangeTreeData.event;

    constructor(public model: GladeModel) {}

    getTreeItem(
        element: GladeFolderItem,
    ): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(
        element?: GladeFolderItem,
    ): vscode.ProviderResult<GladeFolderItem[]> {
        const id = !element ? this.model.rootFolder() : element.entry_id;
        const children = this.model.folderChildren(id);
        return children.map((child) => {
            return new GladeFolderItem(
                child,
                this.model.name(child),
                this.model.iconPath(child),
            );
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(null);
    }
}

enum GladeItemType {
    Folder = "gladeFolder",
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

type GladeFolderEntry = {
    id: GladeId;
    name: string;
    color: vscode.Color;
    parent: GladeId;
    children: GladeId[];
};

class GladeModel {
    private context: vscode.ExtensionContext;
    private icon_manager: FolderIconManager;

    private entries: Record<GladeId, GladeFolderEntry>;
    private root: GladeFolderEntry;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.icon_manager = new FolderIconManager(
            context.globalStorageUri.fsPath,
        );

        this.entries = {};

        const root_id = generateGladeId();
        this.root = {
            id: root_id,
            name: "",
            color: new vscode.Color(1.0, 1.0, 1.0, 1.0),
            parent: root_id,
            children: [],
        };
        this.entries[root_id] = this.root;
    }

    load(): void {
        const glade_state = this.context.workspaceState.get<{
            entries: Record<GladeId, GladeFolderEntry>;
            tree: GladeFolderEntry;
        }>("glade_state");

        if (glade_state) {
            this.entries = glade_state.entries;
            this.root = glade_state.tree;
        }
    }

    rootFolder(): GladeId {
        return this.root.id;
    }

    createFolder(parent: GladeId, name: string): void {
        const id = generateGladeId();
        this.entries[id] = {
            id,
            name,
            parent: parent,
            color: new vscode.Color(1.0, 1.0, 1.0, 1.0),
            children: [],
        };
        this.entries[parent].children.push(id);
        this.save();
    }

    name(id: GladeId): string {
        return this.entries[id].name;
    }

    setName(id: GladeId, name: string): void {
        this.entries[id].name = name;
        this.save();
    }

    color(id: GladeId): vscode.Color {
        return this.entries[id].color;
    }

    setColor(id: GladeId, color: vscode.Color): void {
        this.entries[id].color = color;
        this.save();
    }

    iconPath(id: GladeId): string {
        const color = this.color(id);
        this.icon_manager.generate(color);
        return this.icon_manager.pathOf(color);
    }

    folderChildren(id: GladeId): GladeId[] {
        return this.entries[id].children;
    }

    remove(id: GladeId): void {
        if (id === this.root.id) return;

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

        for (let child of this.entries[id].children) {
            this.removeRecursive(child);
        }

        delete this.entries[id];
    }

    private parentOf(id: GladeId): GladeFolderEntry {
        const parent_id = this.entries[id].parent;
        return this.entries[parent_id];
    }

    private async save() {
        await this.context.workspaceState.update("glade_state", {
            entries: this.entries,
            tree: this.root,
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

    const initial_color = model.color(id);
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

                model.setColor(id, color);
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
