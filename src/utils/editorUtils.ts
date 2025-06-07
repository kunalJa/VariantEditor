import { Editor, MarkdownView } from 'obsidian';

/**
 * Forces a complete re-render of the editor using a zero-width space hack
 * This is a workaround for cases where normal refresh methods don't work
 * @param view The active MarkdownView
 */
export function hackToRerender(view: MarkdownView): void {
  if (!view || !view.editor) {
    return;
  }
  
  try {
    const editor = view.editor;
    const cursorPos = editor.getCursor();
    
    // Use setTimeout to avoid update-during-update errors
    setTimeout(() => {
      try {
        // Insert a zero-width space character and then immediately remove it
        // This forces a complete redraw without visible changes
        const pos = { line: cursorPos.line, ch: cursorPos.ch };
        editor.replaceRange("\u200B", pos); // Insert zero-width space
        editor.replaceRange("", pos, { line: pos.line, ch: pos.ch + 1 }); // Remove it
        
        // Also try to access the CM editor view directly if possible
        const editorView = (view.editor as any).cm;
        if (editorView) {
          // Force a complete redraw
          editorView.requestMeasure();
        }
      } catch (err) {
        console.error('Error in hackToRerender:', err);
      }
    }, 10);
  } catch (e) {
    console.error('Error setting up hackToRerender:', e);
  }
}
