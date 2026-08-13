import * as vscode from "vscode";
import path from "node:path";
import fs from "node:fs";

// Nothing to see here...

export class IconGenerator {
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

        const file_path = path.join(
            this.basePath,
            this.createColorIndicatorFileName(color),
        );
        if (fs.existsSync(file_path)) return file_path;

        const svg = this.createColorIndicatorSvg(color);
        await fs.promises.writeFile(file_path, svg);

        return file_path;
    }

    colorIndicatorFilePath(color: vscode.Color): string {
        return path.join(
            this.basePath,
            this.createColorIndicatorFileName(color),
        );
    }

    private createColorIndicatorFileName(color: vscode.Color): string {
        const name = new Rgb24Stringer(color).asName();
        return `glade-folder-color-${name}.svg`;
    }

    private createColorIndicatorSvg(color: vscode.Color): string {
        const rgb_function = new Rgb24Stringer(color).asFunction();
        return `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
                <rect x="25" y="25" width="50" height="50" rx="10" ry="10" fill="${rgb_function}"/>
            </svg>
        `;
    }
}

class Rgb24Stringer {
    constructor(private readonly color: vscode.Color) {}

    asFunction(): string {
        return `rgb(${this.red()}, ${this.green()}, ${this.blue()})`;
    }

    asName(): string {
        return `${this.red()}-${this.green()}-${this.blue()}`;
    }

    private red(): string {
        return this.component(this.color.red);
    }

    private green(): string {
        return this.component(this.color.green);
    }

    private blue(): string {
        return this.component(this.color.blue);
    }

    private component(component: number): string {
        return (component * 255.0).toFixed(0);
    }
}
