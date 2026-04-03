import * as vscode from "vscode";

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
                .showInputBox({
                    prompt: "Folder Name",
                    value: "",
                })
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
        return children.map(
            (child) => new GladeFolderItem(child, this.model.name(child)),
        );
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
    ) {
        super(name, vscode.TreeItemCollapsibleState.Collapsed);
        this.contextValue = GladeItemType.Folder;
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
    parent: GladeId;
    children: GladeId[];
};

class GladeModel {
    private context: vscode.ExtensionContext;
    private entries: Record<GladeId, GladeFolderEntry>;
    private root: GladeFolderEntry;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.entries = {};

        const root_id = generateGladeId();
        this.root = { id: root_id, name: "", parent: root_id, children: [] };
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
        this.entries[id] = { id, name, parent: parent, children: [] };
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
