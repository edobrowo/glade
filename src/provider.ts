import * as vscode from "vscode";
import { Collapsible, EntryId, EntryKind, Model } from "./model";

export enum ItemType {
    File = "gladeFile",
    Folder = "gladeFolder",
    Label = "gladeLabel",
}

export class WorkspaceItem extends vscode.TreeItem {
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

        // Cache-busting shenanigans. Each pair of entry and expansion state
        // needs its own unique entry in order for auto-expansion to function
        // properly.
        this.id =
            collapsible_state !== undefined
                ? `${entry_id}-${collapsible_state}`
                : (entry_id as string);
    }
}

export class FileTreeItem extends WorkspaceItem {
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

export class FolderTreeItem extends WorkspaceItem {
    constructor(
        entry_id: EntryId,
        name: string,
        icon_path: string,
        collapsible: vscode.TreeItemCollapsibleState,
    ) {
        super(entry_id, name, collapsible);

        this.contextValue = ItemType.Folder;
        this.iconPath = icon_path;
        console.log(icon_path);
    }

    name(): string {
        return typeof this.label === "string"
            ? this.label
            : (this.label?.label ?? "");
    }
}

export class LabelItem extends vscode.TreeItem {
    constructor(label: string, icon_path: vscode.Uri) {
        super(label, vscode.TreeItemCollapsibleState.None);

        this.id = crypto.randomUUID();
        this.contextValue = ItemType.Label;
        this.iconPath = icon_path;
    }
}

export type ProviderItem = WorkspaceItem | LabelItem;

export class Provider implements vscode.TreeDataProvider<ProviderItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProviderItem | null> =
        new vscode.EventEmitter<ProviderItem | null>();
    readonly onDidChangeTreeData: vscode.Event<ProviderItem | null> =
        this._onDidChangeTreeData.event;

    private model: Model;
    private treeView?: vscode.TreeView<vscode.TreeItem>;

    constructor(model: Model, private context: vscode.ExtensionContext) {
        this.model = model;
    }

    getTreeItem(element: ProviderItem): ProviderItem {
        return element;
    }

    bindView(tree_view: vscode.TreeView<ProviderItem>): void {
        this.treeView = tree_view;
    }

    getChildren(
        element?: FolderTreeItem,
    ): vscode.ProviderResult<ProviderItem[]> {
        const id = !element ? this.model.root() : element.entryId;

        if (this.model.kind(id) == EntryKind.Folder) {
            const children = this.model.folderChildren(id);

            // If the root has no model entries, display a placeholder.
            // This also solves a bug where drag and drop cannot find
            // a target when the tree view is empty.
            if (!element && children.length === 0) {
                const icon_path = vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "images",
                    "glade.png",
                );
                return [new LabelItem("Empty glade.", icon_path)];
            }

            return children.map((child) => {
                if (this.model.kind(child) == EntryKind.Folder) {
                    return this.createFolderItem(child);
                } else {
                    return this.createFileItem(child);
                }
            });
        }

        return [];
    }

    getParent(element: ProviderItem): vscode.ProviderResult<FolderTreeItem> {
        if (element instanceof LabelItem) {
            return null;
        }

        const parent_id = this.model.parent(element.entryId);

        // The root is not an element, so all top-level elements must return
        // as null.
        if (!parent_id || parent_id === this.model.root()) {
            return null;
        }

        return this.createFolderItem(parent_id);
    }

    rootFolder(): EntryId {
        return this.model.root();
    }

    resolveTargetFolder(id: EntryId): EntryId {
        if (this.model.kind(id) == EntryKind.Folder) return id;
        const parent_id = this.model.parent(id);
        return parent_id || this.model.root();
    }

    async trackFile(folder_id: EntryId, uri: vscode.Uri): Promise<void> {
        const result = await this.model.fileCreate(folder_id, uri);
        if (!result) {
            vscode.window.showWarningMessage("File already tracked in folder.");
            return;
        }
        await this.model.folderSetCollapsible(folder_id, Collapsible.Expanded);

        this.refresh();

        this.expandFolder(folder_id);
    }

    async createFolder(parent_folder_id: EntryId, name: string): Promise<void> {
        const result = await this.model.folderCreate(parent_folder_id, name);
        if (!result) {
            vscode.window.showWarningMessage("Folder name in use.");
            return;
        }
        await this.model.folderSetCollapsible(
            parent_folder_id,
            Collapsible.Expanded,
        );

        this.refresh();

        this.expandFolder(parent_folder_id);
    }

    async moveEntry(id: EntryId, target_folder_id: EntryId): Promise<void> {
        const old_parent_id = this.model.parent(id);

        const result = await this.model.move(id, target_folder_id);
        if (!result) {
            vscode.window.showWarningMessage(
                "Entry already exists in target folder.",
            );
            return;
        }

        if (old_parent_id) {
            await this.model.folderSetCollapsible(
                target_folder_id,
                Collapsible.Expanded,
            );

            const is_empty = this.model.folderIsEmpty(old_parent_id);
            if (is_empty) {
                await this.model.folderSetCollapsible(
                    old_parent_id,
                    Collapsible.None,
                );
            }
        }

        this.refresh();

        this.expandFolder(target_folder_id);
    }

    async removeEntry(id: EntryId): Promise<void> {
        const folder_id = this.model.parent(id);

        await this.model.remove(id);

        if (!folder_id) {
            this.refresh();
            return;
        }

        const is_empty = this.model.folderIsEmpty(folder_id);
        if (is_empty) {
            await this.model.folderSetCollapsible(folder_id, Collapsible.None);
        }

        this.refresh();
    }

    async setFolderName(folder_id: EntryId, name: string): Promise<void> {
        await this.model.folderSetName(folder_id, name);

        this.refresh();
    }

    folderColor(folder_id: EntryId): vscode.Color {
        return this.model.folderColor(folder_id);
    }

    async setFolderColor(
        folder_id: EntryId,
        color: vscode.Color,
    ): Promise<void> {
        await this.model.folderSetColor(folder_id, color);

        this.refresh();
    }

    async collapseAll(top_folder_id: EntryId): Promise<void> {
        await vscode.commands.executeCommand(
            "workbench.actions.treeView.gladeTrees.collapseAll",
        );

        const descendents = this.model.descendents(top_folder_id);

        const folders_to_collapse = [top_folder_id, ...descendents].filter(
            (id) => this.model.kind(id) == EntryKind.Folder,
        );

        for (const id of folders_to_collapse) {
            if (this.model.folderCollapsible(id) !== Collapsible.Expanded)
                continue;
            await this.model.folderSetCollapsible(id, Collapsible.Collapsed);
        }

        this.refresh();
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

    createFileItem(id: EntryId): FileTreeItem {
        return new FileTreeItem(id, this.model.fileUri(id));
    }

    private async expandFolder(folder_id: EntryId): Promise<void> {
        if (!this.treeView) return;
        if (folder_id == this.rootFolder()) return;

        const folder_item = this.createFolderItem(folder_id);
        try {
            await this.treeView.reveal(folder_item, {
                expand: true,
                select: false,
                focus: false,
            });
        } catch (error) {
            console.error("Failed to expand folder in TreeView", error);
        }
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
