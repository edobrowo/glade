import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
    console.log("activate");

    const disposable: vscode.Disposable = vscode.commands.registerCommand(
        "extension.hello",
        () => {
            vscode.window.showInformationMessage("Hello, world!");
        },
    );

    vscode.window.registerTreeDataProvider(
        "trackedFiles",
        new GladeProvider(context),
    );

    context.subscriptions.push(disposable);
}

// TreeView API: https://code.visualstudio.com/api/extension-guides/tree-view
export class GladeProvider implements vscode.TreeDataProvider<TextItem> {
    private entries: Array<string>;

    constructor(private context: vscode.ExtensionContext) {
        this.entries = [
            "epic item",
            "cool item",
            "awesome item",
            "amazing item",
            "very epic item",
        ];
    }

    getTreeItem(
        element: TextItem,
    ): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: TextItem): vscode.ProviderResult<TextItem[]> {
        if (element != null) {
            //
        } else {
            return this.entries.map(
                (content) =>
                    new TextItem(content, vscode.TreeItemCollapsibleState.None),
            );
        }
    }
}

class TextItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    ) {
        super(label, collapsibleState);
    }
}
