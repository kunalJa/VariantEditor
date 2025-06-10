import { App, Modal, Setting, ButtonComponent, EditorPosition } from 'obsidian';

/**
 * Modal for text input that appears after highlighting
 * Used to create variants for the selected text
 */
export class TextInputModal extends Modal {
  private variants: string[] = [];
  private activeVariantIndex: number = 0;
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
    } else {
      this.variants = [originalText];
      this.activeVariantIndex = 0;
    }
    
    this.cursorPosition = cursorPosition;
    this.currentFrom = currentFrom || cursorPosition;
    this.currentTo = currentTo;
  }

  onOpen() {
    const {contentEl, modalEl} = this;
    
    // Add classes for styling
    modalEl.addClass('variant-editor-modal');
    modalEl.addClass('variant-editor-no-dim'); // Class to remove background dimming
    
    // Create a flex container for all content to support column-reverse when above
    const flexContainer = contentEl.createDiv({
      cls: 'variant-editor-flex-container'
    });
    
    // Position the modal relative to the cursor if we have cursor position
    if (this.cursorPosition) {
      // We need to position the modal after it's rendered
      setTimeout(() => {
        this.positionModalRelativeToCursor(modalEl);
      }, 0);
    }
    
    // Change title based on whether we're editing an existing variant or creating a new one
  const isEditing = this.variants.length > 1;
  flexContainer.createEl('h2', {text: isEditing ? 'Edit Variants' : 'Create Variants'});
    
    // Show the original text or selected variant
    flexContainer.createEl('div', {
      text: isEditing ? `Selected variant: "${this.variants[this.activeVariantIndex]}"` : `Original text: "${this.originalText}"`,
      cls: 'variant-editor-original-text'
    });
    
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
    
    // Add explanation
    flexContainer.createEl('div', {
      text: 'Select which variant should be active with the radio buttons',
      cls: 'variant-editor-hint'
    });
    
    // Add buttons container
    const buttonsContainer = flexContainer.createDiv({
      cls: 'variant-editor-buttons'
    });
    
    // Cancel button
    new ButtonComponent(buttonsContainer)
      .setButtonText('Cancel')
      .onClick(() => this.close())
      .buttonEl.addClass('variant-editor-button');
    
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
    
    // Create/Update variants button
    new ButtonComponent(buttonsContainer)
      .setButtonText(isEditing ? 'Update Variants' : 'Create Variants')
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
    if (top + modalRect.height > viewportHeight) {
      // Position above the line instead
      top = lineRect.top - padding;
      positionAbove = true;
    }
    
    // Center horizontally relative to the line
    const left = lineRect.left + (lineRect.width / 2) - (modalRect.width / 2);
    
    // Apply the position
    modalEl.style.position = 'fixed';
    
    if (positionAbove) {
      // When positioned above, align to bottom and make it grow upward
      modalEl.style.top = 'auto';
      modalEl.style.bottom = `${Math.max(0, viewportHeight - top)}px`;
      modalEl.classList.add('variant-editor-modal-above');
    } else {
      // When positioned below, align to top and make it grow downward (default)
      modalEl.style.top = `${Math.max(0, top)}px`;
      modalEl.style.bottom = 'auto';
      modalEl.classList.remove('variant-editor-modal-above');
    }
    
    modalEl.style.left = `${Math.max(0, left)}px`;
    modalEl.style.transform = 'none';
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
      
      // Try to find the current active variant in the filtered list
      for (let i = 0; i < nonEmptyVariantsWithIndices.length; i++) {
        if (nonEmptyVariantsWithIndices[i].originalIndex === this.activeVariantIndex) {
          newActiveIndex = i;
          activeVariantFound = true;
          break;
        }
      }
      
      // If we're adding a new variant and it's empty, use the last non-empty variant
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
      const variantRow = this.variantContainer.createDiv({
        cls: 'variant-editor-row'
      });
      
      // Radio button for selecting active variant
      const radioContainer = variantRow.createDiv({
        cls: 'variant-editor-radio-container'
      });
      
      const radioInput = radioContainer.createEl('input', {
        cls: 'variant-editor-radio',
        attr: {
          type: 'radio',
          name: 'active-variant',
          id: `variant-${index}`,
          checked: this.activeVariantIndex === index
        }
      });
      
      radioInput.addEventListener('change', () => {
        if (radioInput.checked) {
          this.activeVariantIndex = index;
          // Update the editor immediately when a radio button is clicked
          this.updateVariantsInEditor();
        }
      });
      
      // Label for the variant
      const variantLabel = variantRow.createDiv({
        cls: 'variant-editor-label',
        text: index === 0 ? 'Original:' : `Variant ${index}:`
      });
      
      // Input for the variant
      const variantInput = variantRow.createEl('input', {
        cls: 'variant-editor-input',
        attr: {
          type: 'text',
          value: variant,
          placeholder: 'Enter variant text'
        }
      });
      
      // Update the variant when the input changes
      variantInput.addEventListener('input', (e) => {
        this.variants[index] = (e.target as HTMLInputElement).value.trim();
        
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
            }
            this.updateVariantsInEditor();
          }
        }, 500); // 500ms debounce
        
        variantInput.dataset.updateTimeout = timeoutId.toString();
      });
      
      // Don't allow deleting the original variant
      if (index > 0) {
        // Delete button
        const deleteButton = variantRow.createEl('button', {
          cls: 'variant-editor-delete-button',
          text: '×'
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
          
          this.variants.splice(index, 1);
          this.renderVariantInputs();
        });
      }
      
      // Focus the first empty input
      if (variant === '' && index === this.variants.length - 1) {
        setTimeout(() => variantInput.focus(), 10);
      }
    });
  }


  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
