import { MarkdownView, Plugin, Notice, Editor, EditorPosition } from 'obsidian';
import { hackToRerender } from './utils/editorUtils';
import { TextInputModal } from './modals/TextInputModal';

// Import CodeMirror modules directly as per Obsidian documentation
import { ViewUpdate, PluginValue, EditorView, ViewPlugin, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, Extension } from '@codemirror/state';

// No longer need the ActiveVariantWidget class as we're using CSS-based approach

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
      
      // Register the editor extension for variant indicators
      this.registerEditorExtension(this.createVariantIndicatorExtension());
      this.registerEditorExtension(this.dimExtension);
    } catch (e) {
      console.error('Error during initialization:', e);
    }
  }

  onunload() {
    this.clearHighlight();
  }
  
  /**
   * Creates an extension that styles variant syntax to show only the active variant
   * while keeping the original text editable
   */
  private createVariantIndicatorExtension(): Extension {
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        
        constructor(view: EditorView) {
          this.decorations = this.buildDecorations(view);
        }
        
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view);
          }
        }
        
        buildDecorations(view: EditorView): DecorationSet {
          const builder = new RangeSetBuilder<Decoration>();
          
          for (let {from, to} of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to);
            const variantRegex = /\{\{([^{}]+?)\}\}\^(\d+)/g;
            let match;
            
            while ((match = variantRegex.exec(text)) !== null) {
              const matchStart = from + match.index;
              const matchEnd = matchStart + match[0].length;
              const fullMatch = match[0];
              const variantsText = match[1];
              const activeIndex = parseInt(match[2], 10);
              
              // Find the position of the active variant
              let pos = 0;
              if (activeIndex === 0) {
                pos += 2; // Skip past the opening {{
              } 
              for (let i = 0; i < activeIndex; i++) {
                pos = fullMatch.indexOf('|', pos) + 1;
              }
              
              const activeVariantStart = matchStart + pos;
              const activeVariantEnd = activeVariantStart + variantsText.split('|')[activeIndex].length;
              
              // Add three decorations for each variant:
              // 1. Hide everything before the active variant
              builder.add(
                matchStart,
                activeVariantStart,
                Decoration.mark({
                  attributes: {
                    class: 'variant-syntax-start',
                    'data-full-variant': fullMatch,
                    'data-variant-index': activeIndex.toString()
                  }
                })
              );
              
              // 2. Show the active variant
              builder.add(
                activeVariantStart,
                activeVariantEnd,
                Decoration.mark({
                  attributes: {
                    class: 'variant-active-option',
                    'data-full-variant': fullMatch,
                    'data-variant-index': activeIndex.toString()
                  }
                })
              );
              
              // 3. Hide everything after the active variant
              builder.add(
                activeVariantEnd,
                matchEnd,
                Decoration.mark({
                  attributes: {
                    class: 'variant-syntax-end',
                    'data-full-variant': fullMatch,
                    'data-variant-index': activeIndex.toString()
                  }
                })
              );
            }
          }
          
          return builder.finish();
        }
      },
      {
        decorations: v => v.decorations
      }
    );
  }
  
  private createDimExtension(): Extension {
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
          
          // First pass: Add decorations to all lines except the active one
          // This ensures line decorations are added in order
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
            }
          }
          
          // Second pass: Add highlight decorations for the active line if needed
          if (pluginInstance.selectedText && activeLine <= view.state.doc.lines) {
            try {
              const line = view.state.doc.line(activeLine);
              const lineText = line.text;
              const selectedText = pluginInstance.selectedText;
              
              // Collect all occurrences first and sort them
              const highlights = [];
              let searchIndex = 0;
              let foundIndex;
              
              while ((foundIndex = lineText.indexOf(selectedText, searchIndex)) !== -1) {
                const start = line.from + foundIndex;
                const end = start + selectedText.length;
                highlights.push({ start, end });
                searchIndex = foundIndex + selectedText.length;
              }
              
              // Sort highlights by start position
              highlights.sort((a, b) => a.start - b.start);
              
              // Add them in sorted order
              for (const { start, end } of highlights) {
                builder.add(
                  start,
                  end,
                  Decoration.mark({
                    attributes: { class: "fh-highlight" }
                  })
                );
              }
            } catch (e) {
              console.error(`Error adding highlight decoration:`, e);
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
      if (!view) return;

      const editor = view.editor;
      const selection = editor.listSelections()[0];
      
      // Variants only work within single lines
      if (selection.anchor.line !== selection.head.line) {
        new Notice('Selection must be within a single line');
        return;
      }
      
      // Get the selected text and range
      const from = {
        line: Math.min(selection.anchor.line, selection.head.line),
        ch: Math.min(selection.anchor.ch, selection.head.ch)
      };
      
      const to = {
        line: Math.max(selection.anchor.line, selection.head.line),
        ch: Math.max(selection.anchor.ch, selection.head.ch)
      };
      
      const selectedText = editor.getRange(from, to);
      if (!selectedText) return;
      
      this.selectedText = selectedText;
      
      // Setup for variant editing
      let initialText = selectedText;
      let initialActiveIndex = 0;
      let isExistingVariant = false;
      
      // Check if the selection is already a variant
      const variantRegex = /^\{\{([^{}]+?)\}\}\^(\d+)$/;
      const variantMatch = selectedText.match(variantRegex);
      
      if (variantMatch) {
        // Direct selection of a variant
        initialText = variantMatch[1];
        initialActiveIndex = parseInt(variantMatch[2], 10);
        isExistingVariant = true;
      } else {
        // Check if we're clicking inside a variant
        const line = editor.getLine(from.line);
        if (line) {
          const fullLineRegex = /\{\{([^{}]+?)\}\}\^(\d+)/g;
          let match;
          
          while ((match = fullLineRegex.exec(line)) !== null) {
            const matchStart = match.index;
            const matchEnd = matchStart + match[0].length;
            
            if (from.ch >= matchStart && to.ch <= matchEnd) {
              // Selection is inside a variant
              initialText = match[1];
              initialActiveIndex = parseInt(match[2], 10);
              isExistingVariant = true;
              
              // Expand selection to cover the entire variant
              from.ch = matchStart;
              to.ch = matchEnd;
              editor.setSelection(from, to);
              break;
            }
          }
        }
      }
      
      if (isExistingVariant) {
        new Notice('Editing existing variant');
      }
      
      // Open the variant editor modal
      new TextInputModal(
        this.app,
        initialText,
        (variantText, activeIndex, commitVariant) => {
          if (commitVariant) {
            // Replace the variant with just the active variant text
            if (variantText) {
              editor.replaceRange(variantText, from, to);
              new Notice(`Committed variant: "${variantText}"`);
            }
          } else {
            // Create or update the variant syntax
            const variants = variantText.split('|').filter(v => v);
            
            if (variants.length > 0) {
              const activeIdx = typeof activeIndex === 'number' ? activeIndex : 0;
                const variantSyntax = `{{${variants.join('|')}}}^${activeIdx}`;
              
              editor.replaceRange(variantSyntax, from, to);
              
              const action = isExistingVariant ? 'Updated' : 'Created';
              new Notice(`${action} variant with ${variants.length} options (${variants[activeIdx]} active)`);
            }
          }
          
          this.clearHighlight();
        },
        from,
        initialActiveIndex
      ).open();

    } catch (e) {
      console.error('Error in highlightSelection:', e);
    }
  }

  private clearHighlight(): void {
    try {
      // Reset state
      this.activeLine = null;
      this.previousCursorLine = null;
      this.selectedText = null;
      
      // Force editor refresh
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) hackToRerender(view);
    } catch (e) {
      console.error('Error in clearHighlight:', e);
    }
  }
}
