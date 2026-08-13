import * as vscode from "vscode";
import { IconGenerator } from "./icon_generator";

type Brand<T, B> = T & { readonly __brand: B };

export type EntryId = Brand<string, "EntryId">;

function generateGladeId(): EntryId {
    return crypto.randomUUID() as EntryId;
}

export enum Collapsible {
    None = "none",
    Collapsed = "collapsed",
    Expanded = "expanded",
}

export enum EntryKind {
    File = "file",
    Folder = "folder",
}

export class BaseEntry {
    readonly kind: EntryKind;
    readonly id: EntryId;
    parentId: EntryId | null;

    constructor(kind: EntryKind, id: EntryId, parent_id: EntryId | null) {
        this.kind = kind;
        this.id = id;
        this.parentId = parent_id;
    }
}

export class FileEntry extends BaseEntry {
    uri: vscode.Uri;

    constructor(id: EntryId, parent_id: EntryId, uri: vscode.Uri) {
        super(EntryKind.File, id, parent_id);

        // Reset the URI since its format can change after deserialization.
        this.uri = vscode.Uri.from({
            scheme: uri.scheme,
            authority: uri.authority,
            path: uri.path,
            query: uri.query,
            fragment: uri.fragment,
        });
    }
}

export class FolderEntry extends BaseEntry {
    children: EntryId[] = [];

    name: string;
    color: vscode.Color = new vscode.Color(1.0, 1.0, 1.0, 1.0);
    collapsible: Collapsible = Collapsible.None;

    constructor(id: EntryId, parent_id: EntryId | null, name: string) {
        super(EntryKind.Folder, id, parent_id);
        this.name = name;
    }
}

export type Entry = FileEntry | FolderEntry;

export class Model {
    private context: vscode.ExtensionContext;
    private iconManager: IconGenerator;

    private entries: Record<EntryId, Entry>;
    private rootId: EntryId;

    static load(context: vscode.ExtensionContext): Model | null {
        const glade_state = context.workspaceState.get<{
            entries: Record<EntryId, any>;
            root: EntryId;
        }>("glade_state");
        if (!glade_state) return null;

        let model = new Model(context, glade_state.root);

        for (const [entry_id, entry] of Object.entries(glade_state.entries)) {
            const id = entry_id as EntryId;
            const parent_id = entry.parentId as EntryId;
            const kind = entry.kind;

            switch (kind) {
                case EntryKind.File: {
                    const file = new FileEntry(id, parent_id, entry.uri);

                    model.entries[id] = file;

                    break;
                }
                case EntryKind.Folder: {
                    const folder = new FolderEntry(id, parent_id, entry.name);
                    folder.children = entry.children;
                    folder.color = entry.color;
                    folder.collapsible = entry.collapsible;

                    model.entries[id] = folder;

                    break;
                }
            }
        }

        return model;
    }

    static create(context: vscode.ExtensionContext): Model {
        const root_id = generateGladeId();
        return new Model(context, root_id);
    }

    private constructor(context: vscode.ExtensionContext, root_id: EntryId) {
        this.context = context;
        this.iconManager = new IconGenerator(context.globalStorageUri.fsPath);

        this.entries = {};
        this.rootId = root_id;

        this.entries[this.rootId] = new FolderEntry(this.rootId, null, "");
    }

    root(): EntryId {
        return this.rootId;
    }

    kind(id: EntryId): EntryKind {
        return this.entry(id).kind;
    }

    parent(id: EntryId): EntryId | null {
        return this.entry(id).parentId;
    }

    descendents(id: EntryId): EntryId[] {
        const descendents_recursive = (id: EntryId): EntryId[] => {
            switch (this.kind(id)) {
                case EntryKind.File: {
                    return [];
                }
                case EntryKind.Folder: {
                    return this.folderChildren(id).flatMap((child_id) => [
                        child_id,
                        ...descendents_recursive(child_id),
                    ]);
                }
            }
        };

        return descendents_recursive(id);
    }

    isUriInFolder(uri: vscode.Uri, folder_id: EntryId): boolean {
        return this.folderFileEntries(folder_id).some(
            (entry) => entry.uri.toString() === uri.toString(),
        );
    }

    isSubfolderNameInFolder(name: string, folder_id: EntryId): boolean {
        return this.folderSubfolderEntries(folder_id).some(
            (entry) => entry.name === name,
        );
    }

    isMovableTo(id: EntryId, folder_id: EntryId): boolean {
        switch (this.kind(id)) {
            case EntryKind.File: {
                return !this.isUriInFolder(this.fileUri(id), folder_id);
            }
            case EntryKind.Folder: {
                return !this.isSubfolderNameInFolder(
                    this.folderName(id),
                    folder_id,
                );
            }
        }
    }

    async move(id: EntryId, folder_id: EntryId): Promise<boolean> {
        if (!this.isMovableTo(id, folder_id)) return false;

        const parent_id = this.parent(id);
        if (parent_id) this.removeSubentry(parent_id, id);

        const new_parent_folder = this.tryFolderEntry(folder_id);
        new_parent_folder.children.push(id);

        let entry = this.entry(id);
        entry.parentId = new_parent_folder.id;

        await this.save();

        return true;
    }

    async remove(id: EntryId): Promise<void> {
        if (id === this.rootId) return;

        // Check in case multiple removes were queued on the same entry.
        if (!(id in this.entries)) return;

        const remove_recursive = (id: EntryId): void => {
            const parent_id = this.parent(id);
            if (parent_id) this.removeSubentry(parent_id, id);

            switch (this.kind(id)) {
                case EntryKind.File:
                    break;
                case EntryKind.Folder: {
                    for (let child_id of this.folderChildren(id)) {
                        remove_recursive(child_id);
                    }

                    break;
                }
            }

            delete this.entries[id];
        };

        remove_recursive(id);

        await this.save();
    }

    async renameUri(old_uri: vscode.Uri, new_uri: vscode.Uri): Promise<void> {
        const old_uri_str = old_uri.toString();

        const ids = Object.entries(this.entries)
            .filter(
                ([_, entry]) =>
                    entry.kind === EntryKind.File &&
                    (entry as FileEntry).uri.toString() === old_uri_str,
            )
            .map(([id, _]) => id as EntryId);

        for (const id of ids) {
            let entry = this.tryFileEntry(id);
            entry.uri = new_uri;
        }

        if (ids.length > 0) {
            await this.save();
        }
    }

    async removeFilesByUri(uri: vscode.Uri): Promise<void> {
        const uri_str = uri.toString();

        const ids = Object.entries(this.entries)
            .filter(
                ([_, entry]) =>
                    entry.kind === EntryKind.File &&
                    (entry as FileEntry).uri.toString() === uri_str,
            )
            .map(([id, _]) => id as EntryId);

        for (const id of ids) {
            await this.remove(id);
        }

        if (ids.length > 0) {
            await this.save();
        }
    }

    async fileCreate(folder_id: EntryId, uri: vscode.Uri): Promise<boolean> {
        if (this.isUriInFolder(uri, folder_id)) return false;

        const id = generateGladeId();

        this.entries[id] = new FileEntry(id, folder_id, uri);
        this.pushSubentry(folder_id, id);

        await this.save();

        return true;
    }

    fileUri(id: EntryId): vscode.Uri {
        const file = this.tryFileEntry(id);
        return file.uri;
    }

    async folderCreate(
        parent_folder_id: EntryId,
        name: string,
    ): Promise<boolean> {
        if (this.isSubfolderNameInFolder(name, parent_folder_id)) return false;

        const id = generateGladeId();

        this.entries[id] = new FolderEntry(id, parent_folder_id, name);
        this.pushSubentry(parent_folder_id, id);

        await this.save();

        return true;
    }

    folderChildren(id: EntryId): readonly EntryId[] {
        const folder = this.tryFolderEntry(id);
        return folder.children;
    }

    folderIsEmpty(id: EntryId): boolean {
        return this.folderChildren(id).length === 0;
    }

    folderName(id: EntryId): string {
        const folder = this.tryFolderEntry(id);
        return folder.name;
    }

    async folderSetName(id: EntryId, name: string): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.name = name;

        await this.save();
    }

    folderColor(id: EntryId): vscode.Color {
        const folder = this.tryFolderEntry(id);
        return folder.color;
    }

    async folderSetColor(id: EntryId, color: vscode.Color): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.color = color;

        await this.save();
    }

    folderIconPath(id: EntryId): string {
        const color = this.folderColor(id);
        this.iconManager.generate(color);
        return this.iconManager.colorIndicatorFilePath(color);
    }

    folderCollapsible(id: EntryId): Collapsible {
        let folder = this.tryFolderEntry(id);
        return folder.collapsible;
    }

    async folderSetCollapsible(
        id: EntryId,
        collapsible: Collapsible,
    ): Promise<void> {
        let folder = this.tryFolderEntry(id);
        folder.collapsible = collapsible;

        await this.save();
    }

    private entry(id: EntryId): Entry {
        return this.entries[id];
    }

    private tryFileEntry(id: EntryId): FileEntry {
        if (this.kind(id) !== EntryKind.File) {
            throw new Error("Entry is not a folder");
        }
        return this.entry(id) as FileEntry;
    }

    private tryFolderEntry(id: EntryId): FolderEntry {
        if (this.kind(id) !== EntryKind.Folder) {
            throw new Error("Entry is not a folder");
        }
        return this.entry(id) as FolderEntry;
    }

    private folderFileEntries(id: EntryId): FileEntry[] {
        const folder = this.tryFolderEntry(id);
        return folder.children
            .filter((child_id) => this.kind(child_id) == EntryKind.File)
            .map((child_id) => this.tryFileEntry(child_id));
    }

    private folderSubfolderEntries(id: EntryId): FolderEntry[] {
        const folder = this.tryFolderEntry(id);
        return folder.children
            .filter((child_id) => this.kind(child_id) === EntryKind.Folder)
            .map((child_id) => this.tryFolderEntry(child_id));
    }

    private pushSubentry(parent_id: EntryId, id: EntryId): void {
        const parent_folder = this.tryFolderEntry(parent_id);
        if (parent_folder) {
            parent_folder.children.push(id);
        }
    }

    private removeSubentry(parent_id: EntryId, id: EntryId): void {
        const parent_folder = this.tryFolderEntry(parent_id);
        if (parent_folder) {
            parent_folder.children = parent_folder.children.filter(
                (child_id) => child_id !== id,
            );
        }
    }

    private async save() {
        await this.context.workspaceState.update("glade_state", {
            entries: this.entries,
            root: this.rootId,
        });
    }
}
