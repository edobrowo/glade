import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('activate');

  const disposable: vscode.Disposable = vscode.commands.registerCommand('extension.hello', () => {
    vscode.window.showInformationMessage('Hello, world!');
  });

  context.subscriptions.push(disposable);
}
