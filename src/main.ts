import { MarkdownView, Plugin, Notice, Editor, EditorPosition } from 'obsidian';
import { TextInputModal } from './modals/TextInputModal';

export default class VariantEditor extends Plugin {
 
  async onload() {
    console.log('VariantEditor: Plugin loading...');
    
    try {
      // Bind the method to ensure proper 'this' context
      this.highlightSelection = this.highlightSelection.bind(this);
      
      // Register the command with a direct function reference
      this.addCommand({
        id: 'variant-editor-highlight',
        name: 'Variant Editor: Highlight Word & Sentence',
        hotkeys: [{ modifiers: ["Mod"], key: "h" }],
        callback: () => {
          console.log('VariantEditor: Command callback executed');
          this.highlightSelection();
        }
      });
      
    } catch (error) {
      console.error('VariantEditor: Error during initialization:', error);
    }
  }

  onunload() {
    this.clearHighlight();
  }

  private highlightSelection(): void {
    try {
      console.log('VariantEditor: highlightSelection called');
      
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        console.log('VariantEditor: No active Markdown view');
        return;
      }

      const editor = view.editor;
      const selectedText = editor.getSelection();
      const selectedWord = selectedText.trim();
      
      if (!selectedWord) {
        console.log('VariantEditor: No text selected');
        return;
      }

      const editorEl = view.contentEl;
      if (!editorEl) {
        console.log('VariantEditor: Could not find editor container');
        return;
      }
      
      const lines = editorEl.querySelectorAll('.cm-line');
      console.log(`VariantEditor: Found ${lines.length} lines`);

      lines.forEach(line => {
        if (!line.classList.contains('cm-active')) {
          (line as HTMLElement).classList.add('fh-dim')
        }
      });
      
      // Save cursor position for later text insertion
      const cursorPos = editor.getCursor();
      
      // Open the text input modal after highlighting
      new TextInputModal(this.app, (inputText: string) => {
        if (inputText && inputText.trim()) {
          // Insert the text at the saved cursor position
          editor.replaceRange(inputText, cursorPos);
          new Notice(`Text inserted at cursor position`);
        }
      }).open();

      console.log('VariantEditor: highlightSelection completed');
      
    } catch (e) {
      console.error('VariantEditor: Error in highlightSelection:', e);
    }
  }

  private clearHighlight(): void {
    try {
      console.log('VariantEditor: clearHighlight called');
      
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        console.log('VariantEditor: No active Markdown view in clearHighlight');
        return;
      }
      
      const editorEl = view.contentEl;
      if (!editorEl) {
        console.log('VariantEditor: Could not find editor container in clearHighlight');
        return;
      }
      
      // Remove dim and active classes from all lines
      const lines = editorEl.querySelectorAll('.cm-line');
      lines.forEach(line => (line as HTMLElement).classList.remove('fh-dim'));
      console.log('VariantEditor: clearHighlight completed');
      
    } catch (e) {
      console.error('VariantEditor: Error in clearHighlight:', e);
    }
  }
}
