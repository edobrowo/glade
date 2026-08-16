import * as vscode from "vscode";
import { LabelItem, Provider, ProviderItem, WorkspaceItem } from "./provider";

export class DnDController implements vscode.TreeDragAndDropController<ProviderItem> {
    dropMimeTypes: readonly string[] = [
        "application/vnd.code.tree.glade",
        "text/uri-list",
    ];

    dragMimeTypes: readonly string[] = ["application/vnd.code.tree.glade"];

    constructor(private provider: Provider) {}

    async handleDrag(
        source: readonly ProviderItem[],
        data_transfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        const draggable = source.filter(
            (item): item is WorkspaceItem => item instanceof WorkspaceItem,
        );

        data_transfer.set(
            "application/vnd.code.tree.glade",
            new vscode.DataTransferItem(
                draggable.map((item) => (item as WorkspaceItem).entryId),
            ),
        );
    }

    async handleDrop(
        target: ProviderItem | undefined,
        data_transfer: vscode.DataTransfer,
        _token: vscode.CancellationToken,
    ): Promise<void> {
        if (target instanceof LabelItem) return;

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
