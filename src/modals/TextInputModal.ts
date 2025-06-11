import { App, Modal, Setting, ButtonComponent, setTooltip, EditorPosition } from 'obsidian';

/**
 * Modal for text input that appears after highlighting
 * Used to create variants for the selected text
 */
export class TextInputModal extends Modal {
  private variants: string[] = [];
  private activeVariantIndex: number = 0;
  private lastNonEmptyVariantIndex: number = 0; // Track the last non-empty variant index
  private onSubmit: (result: string, activeIndex?: number, commitVariant?: boolean, currentFrom?: EditorPosition | null, currentTo?: EditorPosition | null) => void;
  private originalText: string;
  private variantContainer: HTMLElement;
  private cursorPosition: EditorPosition | null;
  // Track the current variant position in the editor
  private currentFrom: EditorPosition | null;
  private currentTo: EditorPosition | null;

  constructor(
    app: App, 
    originalText: string,
    onSubmit: (result: string, activeIndex?: number, commitVariant?: boolean, currentFrom?: EditorPosition | null, currentTo?: EditorPosition | null) => void,
    cursorPosition: EditorPosition | null = null,
    initialActiveIndex: number = 0,
    currentFrom: EditorPosition | null = null,
    currentTo: EditorPosition | null = null
  ) {
    super(app);
    this.originalText = originalText;
    this.onSubmit = onSubmit;
    
    // If the originalText contains pipe characters, it might be a variant list
    if (originalText.includes('|')) {
      this.variants = originalText.split('|').filter(v => v);
      this.activeVariantIndex = initialActiveIndex;
      this.lastNonEmptyVariantIndex = initialActiveIndex; // Initialize with the active index
    } else {
      this.variants = [originalText];
      this.activeVariantIndex = 0;
      this.lastNonEmptyVariantIndex = 0;
    }
    
    this.cursorPosition = cursorPosition;
    this.currentFrom = currentFrom || cursorPosition;
    this.currentTo = currentTo;
  }

  onOpen() {
    const {contentEl, modalEl} = this;
    
    // Hide the modal initially to prevent flashing
    if (this.cursorPosition) {
      modalEl.style.opacity = '0';
      modalEl.style.transition = 'opacity 150ms ease-in-out';
    }
    
    // Set the title using Obsidian's built-in functionality
    this.setTitle('Manage Variants');
    
    // Add classes for styling
    modalEl.addClass('variant-editor-modal');
    modalEl.addClass('variant-editor-no-dim'); // Class to remove background dimming
    
    // Create a flex container for all content to support column-reverse when above
    const flexContainer = contentEl.createDiv({
      cls: 'variant-editor-flex-container'
    });
    
    // Position the modal relative to the cursor if we have cursor position
    if (this.cursorPosition) {
      // Position immediately in the next microtask to avoid flashing
      queueMicrotask(() => {
        this.positionModalRelativeToCursor(modalEl);
        // Fade in the modal after positioning
        modalEl.style.opacity = '1';
      });
    }
    
    // We've removed the 'Selected variant' text as requested
    
    // Create container for variant inputs
    this.variantContainer = flexContainer.createDiv({
      cls: 'variant-editor-container'
    });
    
    // Add the first variant (original text)
    this.renderVariantInputs();
    
    // Add button to add new variant
    const addVariantContainer = flexContainer.createDiv({
      cls: 'variant-editor-add-container'
    });
    
    const addVariantButton = new ButtonComponent(addVariantContainer)
      .setButtonText('+ Add Variant')
      .onClick(() => {
        // Store the current active variant index before adding a new one
        const previousActiveIndex = this.activeVariantIndex;
        
        // Add the new variant and set it as active in the UI
        this.variants.push('');
        this.activeVariantIndex = this.variants.length - 1;
        this.renderVariantInputs();
        
        // Focus will be on the new input, but we'll update the editor after a short delay
        // to allow the user to type something in the new variant
        setTimeout(() => {
          // Only update if we have at least two non-empty variants
          const nonEmptyVariants = this.variants.filter(v => v.trim().length > 0);
          if (nonEmptyVariants.length >= 2) {
            // If the new variant is still empty, restore the previous active index
            if (this.variants[this.activeVariantIndex].trim().length === 0) {
              this.activeVariantIndex = previousActiveIndex;
            }
            this.updateVariantsInEditor();
          }
        }, 100);
      });
    
    addVariantButton.buttonEl.addClass('variant-editor-add-button');
    
    // Add buttons container
    const buttonsContainer = flexContainer.createDiv({
      cls: 'variant-editor-buttons'
    });
    
    // Commit active variant button
    new ButtonComponent(buttonsContainer)
      .setButtonText('Commit Active Variant')
      .onClick(() => {
        // Filter out empty variants and track their original indices
        const nonEmptyVariantsWithIndices = this.variants
          .map((v, i) => ({ text: v, originalIndex: i }))
          .filter(v => v.text.length > 0);
        
        // Find the active variant after filtering
        const activeVariant = nonEmptyVariantsWithIndices.find(v => v.originalIndex === this.activeVariantIndex);
        
        if (activeVariant) {
          this.close();
          // Pass the active variant text directly with commitVariant flag
          this.onSubmit(activeVariant.text, undefined, true);
        }
      })
      .buttonEl.addClass('variant-editor-button', 'variant-editor-commit-button');
    
    // Define whether we're editing existing variants or creating new ones
    const hasMultipleVariants = this.variants.length > 1;
    
    // Create/Update variants button
    new ButtonComponent(buttonsContainer)
      .setButtonText(hasMultipleVariants ? 'Update Variants' : 'Create Variants')
      .setCta()
      .onClick(() => {
        this.updateVariantsInEditor();
        this.close();
      })
      .buttonEl.addClass('variant-editor-button');
  }
  
  /**
   * Positions the modal relative to the cursor position
   */
  private positionModalRelativeToCursor(modalEl: HTMLElement) {
    if (!this.cursorPosition) return;
    
    // Get the active editor view
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!activeLeaf || !activeLeaf.view) return;
    
    // Get the editor element
    const editorEl = activeLeaf.view.containerEl.querySelector('.cm-editor');
    if (!editorEl) return;
    
    // Find the line element for the cursor position
    const lineElements = editorEl.querySelectorAll('.cm-line');
    if (!lineElements || lineElements.length <= this.cursorPosition.line) return;
    
    const lineEl = lineElements[this.cursorPosition.line];
    if (!lineEl) return;
    
    // Get the position of the line element
    const lineRect = lineEl.getBoundingClientRect();
    
    // Get the modal dimensions
    const modalRect = modalEl.getBoundingClientRect();
    
    // Position the modal below the line with some padding
    const padding = 10;
    let top = lineRect.bottom + padding;
    let positionAbove = false;
    
    // Make sure the modal doesn't go off the bottom of the screen
    const viewportHeight = window.innerHeight;
    if (top + modalRect.height + 114 > viewportHeight) {
      // Position above the line instead
      // We want the bottom of the modal to be at the top of the line
      top = Math.max(10, lineRect.top - modalRect.height - 150);
      positionAbove = true;
    }
    
    // Center horizontally relative to the line
    let left = lineRect.left + (lineRect.width / 2) - (modalRect.width / 2);
    
    // Make sure the modal doesn't go off the sides of the screen
    const viewportWidth = window.innerWidth;
    if (left < 10) {
      left = 10; // Minimum 10px from left edge
    } else if (left + modalRect.width > viewportWidth - 10) {
      left = viewportWidth - modalRect.width - 10; // Minimum 10px from right edge
    }
    
    // Apply the position
    modalEl.style.position = 'fixed';
    modalEl.style.transform = 'none'; // Remove default centering
    
    if (positionAbove) {
      // When positioned above, set explicit top position
      modalEl.style.top = `${Math.max(0, top)}px`;
      modalEl.style.bottom = 'auto';
      modalEl.classList.add('variant-editor-modal-above');
    } else {
      // When positioned below, set explicit top position
      modalEl.style.top = `${Math.max(0, top)}px`;
      modalEl.style.bottom = 'auto';
      modalEl.classList.remove('variant-editor-modal-above');
    }
    
    modalEl.style.left = `${Math.max(0, left)}px`;
  }

  /**
   * Updates the variants in the editor without closing the modal
   * Returns the new cursor positions for tracking
   */
  private updateVariantsInEditor() {
    // Filter out empty variants and track their original indices
    const nonEmptyVariantsWithIndices = this.variants
      .map((v, i) => ({ text: v, originalIndex: i }))
      .filter(v => v.text.length > 0);
    
    if (nonEmptyVariantsWithIndices.length >= 2) {
      // Find the new index of the active variant after filtering
      let newActiveIndex = 0;
      let activeVariantFound = false;
      
      // Check if the current active variant is empty
      const isActiveVariantEmpty = this.variants[this.activeVariantIndex].trim().length === 0;
      
      if (isActiveVariantEmpty && this.activeVariantIndex !== 0) {
        // If active variant is empty (and not the original), use the last non-empty variant
        // Try to find the last non-empty variant in the filtered list
        for (let i = 0; i < nonEmptyVariantsWithIndices.length; i++) {
          if (nonEmptyVariantsWithIndices[i].originalIndex === this.lastNonEmptyVariantIndex) {
            newActiveIndex = i;
            activeVariantFound = true;
            break;
          }
        }
      } else {
        // Try to find the current active variant in the filtered list
        for (let i = 0; i < nonEmptyVariantsWithIndices.length; i++) {
          if (nonEmptyVariantsWithIndices[i].originalIndex === this.activeVariantIndex) {
            newActiveIndex = i;
            activeVariantFound = true;
            break;
          }
        }
      }
      
      // If we still haven't found an active variant (e.g., if lastNonEmptyVariantIndex is also empty now)
      if (!activeVariantFound && this.activeVariantIndex === this.variants.length - 1) {
        // If we were on the last (new) variant, use the last non-empty variant
        newActiveIndex = nonEmptyVariantsWithIndices.length - 1;
      }
      
      // Join variants with pipe character for the expected format and pass the corrected active index
      const nonEmptyVariants = nonEmptyVariantsWithIndices.map(v => v.text);
      const variantText = nonEmptyVariants.join('|');
      
      // Call onSubmit with the new variant text and active index
      // The third parameter (false) indicates this is not a commit operation
      // We're also passing the current cursor positions for tracking
      this.onSubmit(variantText, newActiveIndex, false, this.currentFrom, this.currentTo);
      
      // Calculate the new cursor positions based on the variant text length
      if (this.currentFrom) {
        // If we have a currentTo position, update it based on the new variant text length
        if (this.currentTo) {
          const variantSyntax = `{{${variantText}}}^${newActiveIndex}`;
          const newTo = {
            line: this.currentFrom.line,
            ch: this.currentFrom.ch + variantSyntax.length
          };
          this.currentTo = newTo;
        }
      }
    }
  }

  private renderVariantInputs() {
    // Clear existing inputs
    this.variantContainer.empty();
    
    // Create an input for each variant
    this.variants.forEach((variant, index) => {
      // Add active class to the row if it's the active variant
      const isActive = this.activeVariantIndex === index;
      
      const variantRow = this.variantContainer.createDiv({
        cls: isActive ? 'variant-editor-row variant-editor-row-active' : 'variant-editor-row'
      });
      
      // Make the entire row clickable to select this variant
      variantRow.addEventListener('click', (e) => {
        // Don't trigger when clicking on delete button or drag handle
        if (!(e.target instanceof HTMLButtonElement)) {
          // Set this as the active variant
          this.activeVariantIndex = index;
          
          // If this variant has content, update the last non-empty variant index
          if (variant.trim().length > 0 || index === 0) {
            this.lastNonEmptyVariantIndex = index;
          }
          
          // If we're clicking directly on the contenteditable div, let its own handler manage focus
          // Otherwise, update the UI and focus the contenteditable
          if (e.target instanceof HTMLDivElement && e.target.hasAttribute('contenteditable')) {
            // Just update the active state visually without re-rendering
            const currentActive = this.variantContainer.querySelector('.variant-editor-row-active');
            if (currentActive && currentActive !== variantRow) {
              currentActive.removeClass('variant-editor-row-active');
              variantRow.addClass('variant-editor-row-active');
              
              // Only update the editor if the selected variant has content
              if (variant.trim().length > 0 || index === 0) {
                this.updateVariantsInEditor();
              }
            }
          } else {
            // For clicks elsewhere in the row, do a full update and focus the input
            this.renderVariantInputs();
            
            // Only update the editor if the selected variant has content
            if (variant.trim().length > 0 || index === 0) {
              this.updateVariantsInEditor();
            }
            
            // Focus the contenteditable div when clicking anywhere else on the row
            setTimeout(() => {
              // Find the contenteditable div in the newly rendered row
              const newRow = this.variantContainer.querySelectorAll('.variant-editor-row')[index];
              if (newRow) {
                const input = newRow.querySelector('.variant-editor-input');
                if (input) {
                  (input as HTMLElement).focus();
                  // Place cursor at the end
                  const range = document.createRange();
                  const sel = window.getSelection();
                  range.selectNodeContents(input as Node);
                  range.collapse(false);
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
              }
            }, 0);
          }
        }
      });
      
      // Drag handle icon for reordering (visual only for now)
      const dragHandle = variantRow.createEl('button', {
        cls: 'variant-editor-drag-handle clickable-icon',
        attr: {
          'aria-label': 'Reorder variants'
        }
      });
      dragHandle.innerHTML = '≡';
      
      // Use Obsidian's setTooltip API to position tooltip above the button
      setTooltip(dragHandle, 'Reorder variants', {
        placement: 'top'
      });
      
      // Input for the variant - placeholder text varies by index
      const placeholder = index === 0 ? 'Original text' : 
                         index === this.variants.length - 1 ? 'Add a variant' : 
                         `Variant ${index}`;
      
      // Create contenteditable div instead of input
      const variantInput = variantRow.createDiv({
        cls: 'variant-editor-input',
        attr: {
          contenteditable: 'true',
          'data-placeholder': placeholder,
          'role': 'textbox',
          'aria-multiline': 'false'
        }
      });
      
      // Set the text content
      variantInput.textContent = variant;
      
      // Add click handler specifically for the contenteditable div
      variantInput.addEventListener('click', (e) => {
        // Only handle the activation if this isn't already the active variant
        // This allows text selection to work when clicking within the already active variant
        if (this.activeVariantIndex !== index) {
          // Set this as the active variant
          this.activeVariantIndex = index;
          
          // If this variant has content, update the last non-empty variant index
          if (variant.trim().length > 0 || index === 0) {
            this.lastNonEmptyVariantIndex = index;
          }
          
          // Only update the rows visually if we're changing the active variant
          const currentActive = this.variantContainer.querySelector('.variant-editor-row-active');
          if (currentActive) {
            currentActive.removeClass('variant-editor-row-active');
          }
          variantRow.addClass('variant-editor-row-active');
          
          // Only update the editor if the selected variant has content
          if (variant.trim().length > 0 || index === 0) {
            // Update the editor immediately when a non-empty variant is selected
            this.updateVariantsInEditor();
          }
        }
        
        // Always focus the input when clicked directly
        (variantInput as HTMLElement).focus();
        
        // Prevent the event from bubbling to avoid double-handling
        e.stopPropagation();
      });
      
      // Update the variant when the input changes
      variantInput.addEventListener('input', (e) => {
        this.variants[index] = variantInput.textContent || '';
        
        // Debounce the update to avoid too many updates while typing
        if (variantInput.dataset.updateTimeout) {
          clearTimeout(parseInt(variantInput.dataset.updateTimeout));
        }
        
        const timeoutId = setTimeout(() => {
          // Only update if we have at least two non-empty variants
          const nonEmptyVariants = this.variants.filter(v => v.trim().length > 0);
          if (nonEmptyVariants.length >= 2) {
            // Make sure the active variant index is set to the current input's index
            // This ensures the variant we're editing is the one that gets shown
            if (this.variants[index].trim().length > 0) {
              this.activeVariantIndex = index;
              // Update the last non-empty variant index when a variant gets content
              this.lastNonEmptyVariantIndex = index;
            }
            this.updateVariantsInEditor();
          }
        }, 300); // 300ms debounce - slightly faster for better responsiveness
        
        variantInput.dataset.updateTimeout = timeoutId.toString();
      });
      
      // Don't allow deleting the original variant
      if (index > 0) {
        // Delete button
        const deleteButton = variantRow.createEl('button', {
          cls: 'variant-editor-delete-button clickable-icon',
          attr: {
            'aria-label': 'Delete variant'
          }
        });
        deleteButton.innerHTML = '×';
        
        // Use Obsidian's setTooltip API to position tooltip above the button
        setTooltip(deleteButton, 'Delete variant', {
          placement: 'top'
        });
        
        deleteButton.addEventListener('click', () => {
          // If deleting the active variant, select the previous one
          if (this.activeVariantIndex === index) {
            this.activeVariantIndex = Math.max(0, index - 1);
          } 
          // If deleting a variant before the active one, adjust the active index
          else if (this.activeVariantIndex > index) {
            this.activeVariantIndex--;
          }
          
          // If we're deleting the last non-empty variant, update it
          if (this.lastNonEmptyVariantIndex === index) {
            // Find the new last non-empty variant
            for (let i = this.variants.length - 1; i >= 0; i--) {
              if (i !== index && (this.variants[i].trim().length > 0 || i === 0)) {
                this.lastNonEmptyVariantIndex = i;
                break;
              }
            }
          }
          
          // Remove the variant from the array
          this.variants.splice(index, 1);
          
          // If we deleted all variants except one, make sure it's not empty
          if (this.variants.length === 1 && this.variants[0].trim() === '') {
            this.variants[0] = ' '; // Use a space as default content
          }
          
          // Re-render the variant inputs
          this.renderVariantInputs();
          
          // Update the editor content to reflect the deletion
          this.updateVariantsInEditor();
        });
      }
      
      // Focus the first empty input
      if (variant === '' && index === this.variants.length - 1) {
        setTimeout(() => {
          variantInput.focus();
          // Place cursor at the end
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(variantInput);
          range.collapse(false); // false means collapse to end
          sel?.removeAllRanges();
          sel?.addRange(range);
        }, 10);
      }
    });
  }


  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
