import { MarkdownView, Plugin, Notice, Editor, EditorPosition } from 'obsidian';
import { hackToRerender } from './utils/editorUtils';
import { TextInputModal } from './modals/TextInputModal';

// Import CodeMirror modules directly as per Obsidian documentation
import { ViewUpdate, PluginValue, EditorView, ViewPlugin, Decoration, DecorationSet } from '@codemirror/view';
import { RangeSetBuilder, StateField, Extension } from '@codemirror/state';

export default class VariantEditor extends Plugin {
  // Track active line for dimming
  private activeLine: number | null = null;
  // Store the extension to update it later
  private dimExtension: Extension | null = null;
  // Track previous cursor line
  private previousCursorLine: number | null = null;
  // Store the selected text for highlighting
  private selectedText: string | null = null;
 
  async onload() {
    try {
      // Bind the method to ensure proper 'this' context
      this.highlightSelection = this.highlightSelection.bind(this);
      this.clearHighlight = this.clearHighlight.bind(this);
      
      // Register the command with a direct function reference
      this.addCommand({
        id: 'variant-editor-highlight',
        name: 'Variant Editor: Highlight Word & Sentence',
        hotkeys: [{ modifiers: ["Mod"], key: "h" }],
        callback: () => this.highlightSelection()
      });
      
      // Register the clear command
      this.addCommand({
        id: 'variant-editor-clear-highlight',
        name: 'Variant Editor: Clear Highlighting',
        callback: () => this.clearHighlight()
      });
      
      // Register the editor extension for dimming
      this.dimExtension = this.createDimExtension();
      this.registerEditorExtension(this.dimExtension);
    } catch (e) {
      console.error('Error during initialization:', e);
    }
  }

  onunload() {
    this.clearHighlight();
  }
  
  private createDimExtension() {
    // Get reference to the plugin instance for the view plugin to use
    const pluginInstance = this;
    
    // Create a state field to track cursor position changes
    const cursorTrackingField = StateField.define({
      create(state) {
        return null;
      },
      update(value, transaction) {
        if (transaction.selection) {
          const selection = transaction.newSelection.main;
          const currentLine = transaction.newDoc.lineAt(selection.head).number;
          
          // Store the current cursor line
          if (pluginInstance.previousCursorLine === null) {
            pluginInstance.previousCursorLine = currentLine;
          }
          
          // If we have an active line and cursor moved to a different line, clear dimming
          if (pluginInstance.activeLine !== null && 
              currentLine !== pluginInstance.activeLine && 
              currentLine !== pluginInstance.previousCursorLine) {
            // Schedule clearing on next tick to avoid update-during-update
            setTimeout(() => {
              pluginInstance.clearHighlight();
            }, 0);
          }
          
          // Update previous cursor line
          pluginInstance.previousCursorLine = currentLine;
        }
        return value;
      }
    });
    
    // Create the view plugin for decorations
    const dimPlugin = ViewPlugin.fromClass(
      class implements PluginValue {
        decorations: DecorationSet;
        
        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }
        
        update(update: ViewUpdate) {          
          // Update decorations if needed
          if (update.docChanged || update.viewportChanged || pluginInstance.activeLine !== null) {
            this.decorations = this.buildDecorations(update.view);
          }
        }
        
        buildDecorations(view: EditorView): DecorationSet {
          // If no active line is set, return empty decorations
          if (pluginInstance.activeLine === null) {
            return Decoration.none;
          }
          
          const builder = new RangeSetBuilder<Decoration>();
          const activeLine = pluginInstance.activeLine;
          
          // Add decorations to all lines except the active one
          for (let i = 1; i <= view.state.doc.lines; i++) {
            if (i !== activeLine) {
              try {
                const line = view.state.doc.line(i);
                const decoration = Decoration.line({
                  attributes: { class: "fh-dim" }
                });
                builder.add(line.from, line.from, decoration);
              } catch (e) {
                console.error(`Error adding decoration to line ${i}:`, e);
              }
            } else if (pluginInstance.selectedText) {
              // This is the active line, add highlight for the selected text
              try {
                const line = view.state.doc.line(i);
                const lineText = line.text;
                const selectedText = pluginInstance.selectedText;
                
                // Find all occurrences of the selected text in this line
                let searchIndex = 0;
                let foundIndex;
                
                while ((foundIndex = lineText.indexOf(selectedText, searchIndex)) !== -1) {
                  const start = line.from + foundIndex;
                  const end = start + selectedText.length;
                  
                  // Add highlight decoration for the selected text
                  builder.add(
                    start,
                    end,
                    Decoration.mark({
                      attributes: { class: "fh-highlight" }
                    })
                  );
                  
                  searchIndex = foundIndex + selectedText.length;
                }
              } catch (e) {
                console.error(`Error adding highlight decoration:`, e);
              }
            }
          }
          
          return builder.finish();
        }
        
        destroy() {}
      },
      {
        decorations: (instance) => instance.decorations
      }
    );
    
    // Return both extensions
    return [cursorTrackingField, dimPlugin];
  }

  private highlightSelection(): void {
    try {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view) {
        return;
      }

      const editor = view.editor;
      const selection = editor.listSelections()[0];
      
      // Check if selection spans multiple lines
      if (selection.anchor.line !== selection.head.line) {
        new Notice('Selection must be within a single line. Variants only work within single lines.');
        return;
      }
      
      const selectedText = editor.getSelection();
      const selectedWord = selectedText.trim();
      
      if (!selectedWord) {
        return;
      }
      
      // Save cursor position for later text insertion
      const cursorPos = editor.getCursor();
      
      // Store the selected text for highlighting
      this.selectedText = selectedWord;
      
      // Set active line for dimming
      this.activeLine = cursorPos.line + 1;
      
      // Clear the selection to prevent the selection overlay from washing out our highlight
      editor.setCursor(cursorPos);
      
      // Force editor refresh to apply decorations
      this.app.workspace.updateOptions();
      
      // // Open the text input modal after highlighting
      // new TextInputModal(this.app, (inputText: string) => {
      //   if (inputText && inputText.trim()) {
      //     // Insert the text at the saved cursor position
      //     editor.replaceRange(inputText, cursorPos);
      //     new Notice(`Text inserted at cursor position`);
      //   }
      // }).open();

    } catch (e) {
      console.error('Error in highlightSelection:', e);
    }
  }

  private clearHighlight(): void {
    try {
      // Reset active line, previous cursor line, and selected text
      this.activeLine = null;
      this.previousCursorLine = null;
      this.selectedText = null;
      
      // Use the hack to force a complete re-render
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        hackToRerender(view);
      }
    } catch (e) {
      console.error('Error in clearHighlight:', e);
    }
  }
}
