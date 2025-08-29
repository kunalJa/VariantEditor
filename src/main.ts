import { MarkdownView, Plugin, Notice, Editor, EditorPosition } from 'obsidian';
import { hackToRerender } from './utils/editorUtils';
import { TextInputModal } from './modals/TextInputModal';

// Import CodeMirror modules directly as per Obsidian documentation
import { ViewUpdate, PluginValue, EditorView, ViewPlugin, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField, Extension } from '@codemirror/state';

/**
 * Widget that renders a clickable variant text
 * Clicking on it will select the variant and open the editor
 */
class ClickableVariantWidget extends WidgetType {
  constructor(
    private plugin: VariantEditor,
    private text: string,
    private fullVariant: string,
    private variantIndex: string,
    private from: number,
    private to: number
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span');
    span.textContent = this.text;
    span.className = 'variant-active-option clickable-variant';
    span.setAttribute('data-full-variant', this.fullVariant);
    span.setAttribute('data-variant-index', this.variantIndex);

    // Add click handler
    span.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Instead of using potentially stale positions, find the variant in the current document
      const state = view.state;
      const doc = state.doc;
      const docText = doc.toString();
      
      // Find the variant pattern in the document
      const variantRegex = new RegExp(this.fullVariant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      let match;
      let variantFound = false;
      
      while ((match = variantRegex.exec(docText)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        
        // Check if this match is around the expected position (within reasonable range)
        if (Math.abs(matchStart - this.from) < 100) { // Allow some drift
          // Set the selection to the entire variant
          view.dispatch({
            selection: { anchor: matchStart, head: matchEnd }
          });
          
          variantFound = true;
          break;
        }
      }
      
      if (!variantFound) {
        // Fallback: try to use original positions but validate they're reasonable
        if (this.from >= 0 && this.to <= doc.length && this.from < this.to) {
          view.dispatch({
            selection: { anchor: this.from, head: this.to }
          });
          variantFound = true;
        }
      }
      
      if (variantFound) {
        // Call the highlightSelection method
        this.plugin.highlightSelection();
      } else {
        console.warn('Could not find variant in document:', this.fullVariant);
      }
    });

    return span;
  }

  eq(other: ClickableVariantWidget): boolean {
    return this.text === other.text &&
      this.fullVariant === other.fullVariant &&
      this.variantIndex === other.variantIndex;
  }
}

export default class VariantEditor extends Plugin {
  // Track active line for dimming - now per editor
  private activeEditorDimming = new Map<EditorView, {
    activeLine: number | null;
    selectedText: string | null;
    selectionFrom: number | null;
    selectionTo: number | null;
    previousCursorLine: number | null;
    dimExtension: Extension | null;
  }>();

  async onload() {
    try {
      // Bind the method to ensure proper 'this' context
      this.highlightSelection = this.highlightSelection.bind(this);
      this.clearHighlight = this.clearHighlight.bind(this);

      // Register the command with a direct function reference
      this.addCommand({
        id: 'variant-editor-highlight',
        name: 'Create variant from selection',
        callback: () => this.highlightSelection()
      });

      // Register the clear command
      this.addCommand({
        id: 'variant-editor-clear-highlight',
        name: 'Clear highlighting',
        callback: () => this.clearHighlight()
      });

      // Register command to commit all variants in selection or document
      this.addCommand({
        id: 'variant-editor-commit-all',
        name: 'Commit all variants in selection/document',
        editorCallback: (editor) => this.commitAllVariants(editor)
      });

      // Register the editor extensions
      this.registerEditorExtension(this.createVariantIndicatorExtension());
      this.registerEditorExtension(this.createGlobalDimExtension());
    } catch (e) {
      console.error('Error during initialization:', e);
    }
  }

  onunload() {
    this.clearHighlight();
    // Clean up all editor-specific dimming
    this.activeEditorDimming.clear();
  }

  /**
   * Creates an extension that styles variant syntax to show only the active variant
   * while keeping the original text editable
   */
  private createVariantIndicatorExtension(): Extension {
    // Store a reference to the plugin instance for the widget to use
    const pluginInstance = this;

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

          for (let { from, to } of view.visibleRanges) {
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

              // 2. Show the active variant as a clickable widget
              const activeVariantText = variantsText.split('|')[activeIndex];
              builder.add(
                activeVariantStart,
                activeVariantEnd,
                Decoration.replace({
                  widget: new ClickableVariantWidget(
                    pluginInstance,
                    activeVariantText,
                    fullMatch,
                    activeIndex.toString(),
                    matchStart,
                    matchEnd
                  )
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

  /**
   * Creates a global extension that only dims lines in the editor that has active variant editing
   */
  private createGlobalDimExtension(): Extension {
    // Get reference to the plugin instance
    const pluginInstance = this;

    // Create a state field to track cursor position changes
    const cursorTrackingField = StateField.define<{ previousCursorLine: number | null }>({
      create(state) {
        return { previousCursorLine: null };
      },
      update(value, transaction) {
        if (transaction.selection) {
          const selection = transaction.newSelection.main;
          const currentLine = transaction.newDoc.lineAt(selection.head).number;
          
          // We'll handle cursor tracking in the view plugin where we have access to the EditorView
          return { previousCursorLine: currentLine };
        }
        return value;
      }
    });

    // Create the view plugin for decorations that only applies to editors with active dimming
    const dimPlugin = ViewPlugin.fromClass(
      class implements PluginValue {
        decorations: DecorationSet;
        private lastCursorLine: number | null = null;
        private view: EditorView;

        constructor(view: EditorView) {
          this.view = view;
          this.decorations = this.buildDecorations(view);
        }

        update(update: ViewUpdate) {
          // Handle cursor movement for clearing dimming
          if (update.selectionSet) {
            const currentLine = update.state.doc.lineAt(update.state.selection.main.head).number;
            const editorState = pluginInstance.activeEditorDimming.get(update.view);
            
            if (editorState && editorState.activeLine !== null) {
              // If cursor moved to a different line than the active line, clear dimming
              if (currentLine !== editorState.activeLine && 
                  currentLine !== this.lastCursorLine) {
                setTimeout(() => {
                  pluginInstance.clearHighlightForEditor(update.view);
                }, 0);
              }
            }
            
            this.lastCursorLine = currentLine;
          }
          
          // Always update decorations to check if this editor should have dimming
          this.decorations = this.buildDecorations(update.view);
        }

        destroy() {
          // Clean up editor state when the view is destroyed (e.g., tab closed)
          // We need to find which editor this view corresponds to and remove its state
          for (const [editorView, editorState] of pluginInstance.activeEditorDimming) {
            if (editorView === this.view) {
              pluginInstance.activeEditorDimming.delete(editorView);
              break;
            }
          }
        }

        buildDecorations(view: EditorView): DecorationSet {
          // Get editor-specific state - only apply dimming if this editor has active variant editing
          const editorState = pluginInstance.activeEditorDimming.get(view);
          
          // If no editor state or no active line is set for this editor, return empty decorations
          if (!editorState || editorState.activeLine === null) {
            return Decoration.none;
          }

          // Collect all decorations first, then sort and add them
          const allDecorations = [];
          const activeLine = editorState.activeLine;
          
          // First pass: Collect line decorations for all lines except the active one
          for (let i = 1; i <= view.state.doc.lines; i++) {
            if (i !== activeLine) {
              try {
                const line = view.state.doc.line(i);
                const decoration = Decoration.line({
                  attributes: { class: "fh-dim" }
                });
                allDecorations.push({
                  from: line.from,
                  to: line.from,
                  decoration: decoration
                });
              } catch (e) {
                console.error(`Error creating decoration for line ${i}:`, e);
              }
            }
          }

          // Second pass: Collect highlight decoration only for the currently selected text in this editor
          if (editorState.selectedText && activeLine <= view.state.doc.lines && editorState.selectionFrom !== null && editorState.selectionTo !== null) {
            try {
              // Use the exact selection positions instead of searching for all instances
              const start = editorState.selectionFrom;
              const end = editorState.selectionTo;

              allDecorations.push({
                from: start,
                to: end,
                decoration: Decoration.mark({
                  attributes: { class: "fh-highlight" }
                })
              });
            } catch (e) {
              console.error(`Error creating highlight decoration:`, e);
            }
          }

          // Sort decorations by position and build the decoration set
          allDecorations.sort((a, b) => a.from - b.from);

          const builder = new RangeSetBuilder<Decoration>();
          for (const { from, to, decoration } of allDecorations) {
            builder.add(from, to, decoration);
          }

          return builder.finish();
        }
      },
      {
        decorations: v => v.decorations
      }
    );

    return [cursorTrackingField, dimPlugin];
  }

  // Make this public so the widget can access it
  highlightSelection(): void {
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

      let selectedText = editor.getRange(from, to);
      if (!selectedText) return;

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

            // Check if selection overlaps with the variant at all
            // This handles partial selections that include any part of the variant
            if ((from.ch >= matchStart && from.ch < matchEnd) || // Selection starts inside variant
              (to.ch > matchStart && to.ch <= matchEnd) ||    // Selection ends inside variant
              (from.ch <= matchStart && to.ch >= matchEnd)) {  // Selection contains variant

              // Selection overlaps with a variant - capture the entire variant
              initialText = match[1];
              initialActiveIndex = parseInt(match[2], 10);
              isExistingVariant = true;

              // Expand selection to cover the entire variant
              from.ch = matchStart;
              to.ch = matchEnd;
              editor.setSelection(from, to);

              // Update selectedText to match the expanded selection
              selectedText = editor.getRange(from, to);
              break;
            }
          }
        }
      }

      if (isExistingVariant) {
        new Notice('Editing existing variant');
      }

      // Get or create editor-specific state
      const editorView = (view.editor as any).cm;
      if (!this.activeEditorDimming.has(editorView)) {
        this.activeEditorDimming.set(editorView, {
          activeLine: null,
          selectedText: null,
          selectionFrom: null,
          selectionTo: null,
          previousCursorLine: null,
          dimExtension: null
        });
      }
      
      const editorState = this.activeEditorDimming.get(editorView)!;

      // Set active line for dimming
      editorState.activeLine = from.line + 1;

      // Store the selected text for highlighting - make sure we use the potentially updated selection
      editorState.selectedText = selectedText;

      // Convert EditorPosition to absolute character positions for highlighting
      if (editorView) {
        try {
          // Convert line/ch positions to absolute character positions
          const fromPos = editorView.state.doc.line(from.line + 1).from + from.ch;
          const toPos = editorView.state.doc.line(to.line + 1).from + to.ch;

          // Store the exact selection range for highlighting
          editorState.selectionFrom = fromPos;
          editorState.selectionTo = toPos;
        } catch (e) {
          console.error('Error converting positions:', e);
        }
      }

      // The global dimming extension will automatically pick up this editor's state
      // No need to register per-editor extensions

      // Force editor refresh to apply decorations
      this.app.workspace.updateOptions();

      // Open the variant editor modal
      new TextInputModal(
        this.app,
        initialText,
        (variantText, activeIndex, commitVariant, currentFrom, currentTo, modalClosed) => {
          // Use the updated cursor positions if provided, otherwise use the original positions
          const updateFrom = currentFrom || from;
          const updateTo = currentTo || to;

          if (modalClosed) {
            // Modal was closed without committing (via ESC key or clicking outside)
            // Clear the highlights
            this.clearHighlightForEditor(editorView);
          } else if (commitVariant === true) {
            // Replace the variant with just the active variant text (commit action)
            if (variantText) {
              editor.replaceRange(variantText, updateFrom, updateTo);
              new Notice(`Committed variant: "${variantText}"`);
              // Clear highlights when committing
              this.clearHighlightForEditor(editorView);
            }
          } else {
            // Create or update the variant syntax (normal variant creation/update)
            const variants = variantText.split('|').filter(v => v);

            if (variants.length > 0) {
              const activeIdx = typeof activeIndex === 'number' ? activeIndex : 0;
              const variantSyntax = `{{${variants.join('|')}}}^${activeIdx}`;

              // Use the updated cursor positions for the replacement
              editor.replaceRange(variantSyntax, updateFrom, updateTo);

              // Update the original positions for future updates
              from.ch = updateFrom.ch;
              to.ch = updateFrom.ch + variantSyntax.length;

              // Update selection positions for highlighting
              try {
                // Convert updated line/ch positions to absolute character positions
                const fromPos = editorView.state.doc.line(updateFrom.line + 1).from + updateFrom.ch;
                const toPos = editorView.state.doc.line(updateFrom.line + 1).from + updateFrom.ch + variantSyntax.length;

                // Update the exact selection range for highlighting
                editorState.selectionFrom = fromPos;
                editorState.selectionTo = toPos;

                // Force editor refresh to update decorations
                this.app.workspace.updateOptions();
              } catch (e) {
                console.error('Error updating selection positions:', e);
              }

              const action = isExistingVariant ? 'Updated' : 'Created';
              // Only show notice on explicit user action, not on every update
              if (commitVariant) {
                new Notice(`${action} variant with ${variants.length} options (${variants[activeIdx]} active)`);
                // Only clear highlights when committing
                this.clearHighlightForEditor(editorView);
              }
              // Don't clear highlights during live updates
            }
          }
        },
        from,
        initialActiveIndex
      ).open();

    } catch (e) {
      console.error('Error in highlightSelection:', e);
    }
  }

  /**
   * Commits all variants in the selection or entire document
   * @param editor The editor instance
   */
  private commitAllVariants(editor: Editor): void {
    try {
      // Get the selection or use the entire document
      let text: string;
      let from: EditorPosition;
      let to: EditorPosition;

      const selection = editor.listSelections()[0];
      if (selection && (selection.anchor.line !== selection.head.line || selection.anchor.ch !== selection.head.ch)) {
        // Use the selection
        from = {
          line: Math.min(selection.anchor.line, selection.head.line),
          ch: Math.min(selection.anchor.ch, selection.head.ch)
        };

        to = {
          line: Math.max(selection.anchor.line, selection.head.line),
          ch: Math.max(selection.anchor.ch, selection.head.ch)
        };

        text = editor.getRange(from, to);
      } else {
        // Use the entire document
        from = { line: 0, ch: 0 };
        to = { line: editor.lineCount() - 1, ch: editor.getLine(editor.lineCount() - 1).length };
        text = editor.getValue();
      }

      // Find all variants in the text
      const variantRegex = /\{\{([^{}]+?)\}\}\^(\d+)/g;
      let match;
      let variantsFound = 0;
      let lastIndex = 0;
      let result = '';

      // Process each variant
      while ((match = variantRegex.exec(text)) !== null) {
        // Add text before this variant
        result += text.substring(lastIndex, match.index);

        // Extract variant information
        const variants = match[1].split('|');
        const activeIndex = parseInt(match[2], 10);

        // Add the active variant text
        if (activeIndex >= 0 && activeIndex < variants.length) {
          result += variants[activeIndex];
          variantsFound++;
        } else {
          // If active index is invalid, keep the original text
          result += match[0];
        }

        // Update lastIndex for next iteration
        lastIndex = match.index + match[0].length;
      }

      // Add any remaining text
      result += text.substring(lastIndex);

      // Replace the text in the editor
      editor.replaceRange(result, from, to);

      // Show a notice with the results
      if (variantsFound > 0) {
        new Notice(`Committed ${variantsFound} variant${variantsFound === 1 ? '' : 's'}`);
      } else {
        new Notice('No variants found to commit');
      }
    } catch (e) {
      console.error('Error in commitAllVariants:', e);
      new Notice('Error committing variants');
    }
  }

  /**
   * Clear highlighting for a specific editor
   */
  private clearHighlightForEditor(editorView: EditorView): void {
    try {
      // Get editor-specific state
      const editorState = this.activeEditorDimming.get(editorView);

      if (editorState) {
        // Reset state for this editor
        editorState.activeLine = null;
        editorState.selectedText = null;
        editorState.selectionFrom = null;
        editorState.selectionTo = null;

        // Force editor refresh to remove decorations
        this.app.workspace.updateOptions();
      }
    } catch (e) {
      console.error('Error in clearHighlightForEditor:', e);
    }
  }

  /**
   * Clear highlighting for all editors (legacy method for compatibility)
   */
  private clearHighlight(): void {
    try {
      // Clear highlighting for all editors
      for (const [editorView, editorState] of this.activeEditorDimming) {
        this.clearHighlightForEditor(editorView);
      }
    } catch (e) {
      console.error('Error in clearHighlight:', e);
    }
  }
}
