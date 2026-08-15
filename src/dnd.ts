import * as vscode from "vscode";
import { Provider, TreeItem } from "./provider";

export class DnDController implements vscode.TreeDragAndDropController<TreeItem> {
    dropMimeTypes: readonly string[] = [
        "application/vnd.code.tree.glade",
        "text/uri-list",
    ];

    dragMimeTypes: readonly string[] = ["application/vnd.code.tree.glade"];

    constructor(private provider: Provider) {}

    async handleDrag(
        source: readonly TreeItem[],
        data_transfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        data_transfer.set(
            "application/vnd.code.tree.glade",
            new vscode.DataTransferItem(source.map((item) => item.entryId)),
        );
    }

    async handleDrop(
        target: TreeItem | undefined,
        data_transfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
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
