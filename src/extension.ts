import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Collapsible, Model } from "./model";
import { FileTreeItem, FolderTreeItem, Provider } from "./provider";
import { DnDController } from "./dnd";

export function activate(context: vscode.ExtensionContext): void {

    let model = loadOrCreateModel(context);
    let provider = setupProvider(context, model);

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
        await model.folderSetCollapsible(
            element.entryId,
            Collapsible.Collapsed,
        );
    });

    // Delete handling.
    const fs_watcher = vscode.workspace.createFileSystemWatcher('**/*');
    fs_watcher.onDidDelete(async (uri) => {
        await model.removeFilesByUri(uri);
        provider.refresh();
    });
    context.subscriptions.push(fs_watcher);

    const rename_listener = vscode.workspace.onWillRenameFiles(async event => {
        for (const file of event.files) {
            await model.renameUri(file.oldUri, file.newUri);
        }
        provider.refresh();
    });
    context.subscriptions.push(rename_listener);
}

function loadOrCreateModel(context: vscode.ExtensionContext): Model {
    let model = Model.load(context);
    if (!model) model = Model.create(context);
    return model;
}

function setupProvider(context: vscode.ExtensionContext, model: Model): Provider {

    const provider = new Provider(model);

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
            openColorPicker(context, provider, item);
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

    return provider;
}

function openColorPicker(
    context: vscode.ExtensionContext,
    provider: Provider,
    item: FolderTreeItem,
): void {
    const panel = vscode.window.createWebviewPanel(
        "gladeColorPicker",
        "Pick Folder Color",
        vscode.ViewColumn.Active,
        {
            enableScripts: true,
        },
    );

    const initial_color = provider.folderColor(item.entryId);
    panel.webview.html = colorPickerContent(context, initial_color);

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

function colorPickerContent(
    context: vscode.ExtensionContext,
    color: vscode.Color,
): string {
    const templatePath = path.join(
        context.extensionPath,
        "src",
        "webview",
        "color-picker.html",
    );

    let html = fs.readFileSync(templatePath, "utf8");

    let r = Math.round(color.red * 255.0);
    let g = Math.round(color.green * 255.0);
    let b = Math.round(color.blue * 255.0);

    html = html.replaceAll("{{RED}}", String(r));
    html = html.replaceAll("{{GREEN}}", String(g));
    html = html.replaceAll("{{BLUE}}", String(b));

    return html;
}
