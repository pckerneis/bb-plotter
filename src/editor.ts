
import * as CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/midnight.css";
import "codemirror/addon/edit/matchbrackets.js";
import "codemirror/mode/javascript/javascript.js";

export let editor: CodeMirror.Editor | null;

export function initialiseEditor(initialCode: string) {
    const editorTextArea =
        document.querySelector<HTMLTextAreaElement>("#bb-editor");

    if (!editorTextArea) {
        throw new Error("Editor textarea #bb-editor not found");
    }

    editorTextArea.value = initialCode;

    editor = (CodeMirror as any).fromTextArea(editorTextArea, {
        mode: "javascript",
        lineNumbers: true,
        theme: "midnight",
        smartIndent: false,
        electricChars: false,
        matchBrackets: true,
    });
}

export function getEditorValue(): string {
    return editor?.getValue() as string;
}
