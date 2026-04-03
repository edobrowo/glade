import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    const model = new GladeModel(context);
    model.load();

    const provider = new GladeProvider(model);

    const tree_view: vscode.TreeView<GladeTextItem> =
        vscode.window.createTreeView("gladeView", {
            treeDataProvider: provider,
        });
    context.subscriptions.push(tree_view);

    const create_text_item: vscode.Disposable = vscode.commands.registerCommand(
        "extension.createTextItem",
        (item: vscode.TreeItem) => {
            let text_item: GladeTextItem = item as GladeTextItem;
            vscode.window
                .showInputBox({
                    prompt: "Name",
                    value: "",
                })
                .then((new_value) => {
                    if (new_value !== undefined) {
                        provider.model.createEntry(new_value);
                    }
                    provider.refresh();
                });
        },
    );
    context.subscriptions.push(create_text_item);

    const remove_text_item: vscode.Disposable = vscode.commands.registerCommand(
        "extension.removeTextItem",
        (item: vscode.TreeItem) => {
            let text_item: GladeTextItem = item as GladeTextItem;
            provider.model.deleteEntry(text_item.entry.id);
            provider.refresh();
        },
    );
    context.subscriptions.push(remove_text_item);

    const edit_text_item: vscode.Disposable = vscode.commands.registerCommand(
        "extension.editTextItem",
        (item: vscode.TreeItem) => {
            let text_item: GladeTextItem = item as GladeTextItem;
            vscode.window
                .showInputBox({
                    prompt: "Edit",
                    value: text_item.labelString(),
                })
                .then((new_value) => {
                    if (new_value !== undefined) {
                        provider.model.updateEntryContent(
                            text_item.entry.id,
                            new_value,
                        );
                    }
                    provider.refresh();
                });
        },
    );
    context.subscriptions.push(edit_text_item);
}

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
// Icons: https://microsoft.github.io/vscode-codicons/dist/codicon.html

export class GladeProvider implements vscode.TreeDataProvider<GladeTextItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<GladeItem> =
        new vscode.EventEmitter<GladeItem>();

    readonly onDidChangeTreeData: vscode.Event<GladeItem> =
        this._onDidChangeTreeData.event;

    constructor(public model: GladeModel) {}

    getTreeItem(
        element: GladeTextItem,
    ): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(
        element?: GladeTextItem,
    ): vscode.ProviderResult<GladeTextItem[]> {
        if (!element) {
            return this.model.entries.map((entry) => new GladeTextItem(entry));
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

enum GladeItemType {
    Text = "gladeTextItem",
}

type GladeItem = GladeTextItem | GladeTextItem[] | undefined | null | void;

class GladeTextItem extends vscode.TreeItem {
    constructor(public readonly entry: GladeEntry) {
        super(entry.content, vscode.TreeItemCollapsibleState.None);
        this.contextValue = GladeItemType.Text;
    }

    labelString(): string {
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

type GladeEntry = {
    id: GladeId;
    content: string;
};

class GladeModel {
    private context: vscode.ExtensionContext;
    public entries: GladeEntry[];

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.entries = [];
    }

    load() {
        this.entries = this.context.workspaceState.get("glade_entries", []);
    }

    createEntry(content: string): void {
        this.entries.push({
            id: generateGladeId(),
            content,
        });
        this.save();
    }

    deleteEntry(id: GladeId): void {
        this.entries = this.entries.filter((entry) => entry.id !== id);
        this.save();
    }

    updateEntryContent(id: GladeId, content: string): void {
        let entry = this.entries.find((value) => value.id === id);
        if (entry === undefined) {
            return;
        }
        entry.content = content;
        this.save();
    }

    private save() {
        this.context.workspaceState
            .update("glade_entries", this.entries)
            .then(() => {});
    }
}
