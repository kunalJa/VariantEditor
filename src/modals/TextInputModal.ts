import { App, Modal, Setting, ButtonComponent, setTooltip, EditorPosition } from 'obsidian';

/**
 * Modal for text input that appears after highlighting
 * Used to create variants for the selected text
 */
export class TextInputModal extends Modal {
  private variants: string[] = [];
  private activeVariantIndex: number = 0;
  private lastNonEmptyVariantIndex: number = 0; // Track the last non-empty variant index
  private onSubmit: (result: string, activeIndex?: number, commitVariant?: boolean, currentFrom?: EditorPosition | null, currentTo?: EditorPosition | null, modalClosed?: boolean) => void;
  private originalText: string;
  private variantContainer: HTMLElement;
  private cursorPosition: EditorPosition | null;
  // Track the current variant position in the editor
  private currentFrom: EditorPosition | null;
  private currentTo: EditorPosition | null;
  
  // Drag and drop properties
  private draggedElement: HTMLElement | null = null;
  private draggedIndex: number = -1;
  private dragOverIndex: number = -1;
  
  // Modal dragging properties
  private isDraggingModal: boolean = false;
  private modalInitialX: number = 0;
  private modalInitialY: number = 0;
  private pointerInitialX: number = 0;
  private pointerInitialY: number = 0;
  
  // Setup draggable header for the modal
  private setupDraggableHeader(dragHeader: HTMLElement, modalEl: HTMLElement) {
    // Mouse events for desktop
    dragHeader.addEventListener('mousedown', (e) => {
      // Only handle left mouse button
      if (e.button !== 0) return;
      
      // Prevent text selection during drag
      e.preventDefault();
      
      // Start dragging
      this.isDraggingModal = true;
      modalEl.addClass('dragging');
      
      // Store initial positions
      const modalRect = modalEl.getBoundingClientRect();
      this.modalInitialX = modalRect.left;
      this.modalInitialY = modalRect.top;
      this.pointerInitialX = e.clientX;
      this.pointerInitialY = e.clientY;
      
      // Setup document-level event listeners
      document.addEventListener('mousemove', this.handleModalMove);
      document.addEventListener('mouseup', this.handleModalRelease);
    });
    
    // Touch events for mobile
    dragHeader.addEventListener('touchstart', (e) => {
      // Prevent scrolling while dragging
      e.preventDefault();
      
      // Start dragging
      this.isDraggingModal = true;
      modalEl.addClass('dragging');
      
      // Store initial positions
      const modalRect = modalEl.getBoundingClientRect();
      this.modalInitialX = modalRect.left;
      this.modalInitialY = modalRect.top;
      this.pointerInitialX = e.touches[0].clientX;
      this.pointerInitialY = e.touches[0].clientY;
      
      // Setup document-level event listeners
      document.addEventListener('touchmove', this.handleModalMove);
      document.addEventListener('touchend', this.handleModalRelease);
    });
  }
  
  // Handle modal movement
  private handleModalMove = (e: MouseEvent | TouchEvent) => {
    if (!this.isDraggingModal) return;
    
    // Get current pointer position
    let clientX: number, clientY: number;
    
    if (e instanceof MouseEvent) {
      clientX = e.clientX;
      clientY = e.clientY;
    } else { // TouchEvent
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    }
    
    // Calculate the distance moved
    const deltaX = clientX - this.pointerInitialX;
    const deltaY = clientY - this.pointerInitialY;
    
    // Calculate new position
    const newX = this.modalInitialX + deltaX;
    const newY = this.modalInitialY + deltaY;
    
    // Apply the new position
    const modalEl = this.modalEl;
    modalEl.style.left = `${newX}px`;
    modalEl.style.top = `${newY}px`;
  }
  
  // Handle modal release
  private handleModalRelease = () => {
    if (!this.isDraggingModal) return;
    
    // Stop dragging
    this.isDraggingModal = false;
    this.modalEl.removeClass('dragging');
    
    // Remove document-level event listeners
    document.removeEventListener('mousemove', this.handleModalMove);
    document.removeEventListener('mouseup', this.handleModalRelease);
    document.removeEventListener('touchmove', this.handleModalMove);
    document.removeEventListener('touchend', this.handleModalRelease);
  }

  constructor(
    app: App, 
    originalText: string,
    onSubmit: (result: string, activeIndex?: number, commitVariant?: boolean, currentFrom?: EditorPosition | null, currentTo?: EditorPosition | null, modalClosed?: boolean) => void,
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
    
    // Make the modal header draggable
    const titleEl = modalEl.querySelector('.modal-title');
    if (titleEl) {
      titleEl.addClass('variant-editor-draggable-title');
      this.setupDraggableHeader(titleEl as HTMLElement, modalEl);
    }
    
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
    
    // Always ensure we have an empty row at the end for adding new variants
    // We'll add an empty variant if there isn't one already
    if (this.variants.length === 0 || this.variants[this.variants.length - 1].trim() !== '') {
      this.variants.push('');
    }
    
    // Add the first variant (original text) and the empty row
    // Focus the active variant (not the empty one at the end)
    this.renderVariantInputs(this.activeVariantIndex);
    
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
    
    // Set the left position
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

  private renderVariantInputs(focusIndex?: number) {
    // Clear existing inputs
    this.variantContainer.empty();
    
    // Create an input for each variant
    this.variants.forEach((variant, index) => {
      // Add active class to the row if it's the active variant
      const isActive = this.activeVariantIndex === index;
      
      // Check if this is the last empty row (add variant placeholder)
      const isLastEmptyRow = index === this.variants.length - 1 && variant.trim() === '';
      
      // Build the row classes
      let rowClasses = 'variant-editor-row';
      if (isActive) rowClasses += ' variant-editor-row-active';
      if (isLastEmptyRow) rowClasses += ' variant-editor-row-add-variant';
      
      const variantRow = this.variantContainer.createDiv({
        cls: rowClasses
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
            this.renderVariantInputs(index);
            
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
      
      // Drag handle icon for reordering
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
      
      // Don't add drag functionality to the "Add a variant" row
      if (!isLastEmptyRow) {
        // Make the drag handle draggable
        dragHandle.setAttribute('draggable', 'true');
        
        // Drag start event
        dragHandle.addEventListener('dragstart', (e) => {
          this.draggedElement = variantRow;
          this.draggedIndex = index;
          
          // Add dragging class for visual feedback
          variantRow.classList.add('dragging');
          
          // Create an invisible drag image to replace the default one
          const dragGhost = document.createElement('div');
          dragGhost.classList.add('variant-editor-drag-ghost');
          document.body.appendChild(dragGhost);
          
          // Set the custom drag image
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', index.toString());
            e.dataTransfer.setDragImage(dragGhost, 0, 0);
            
            // Clean up the ghost element after a short delay
            setTimeout(() => {
              document.body.removeChild(dragGhost);
            }, 0);
          }
        });
        
        // Drag end event
        dragHandle.addEventListener('dragend', () => {
          if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
            this.draggedElement = null;
            this.draggedIndex = -1;
            
            // Remove drag-over class from all rows
            const allRows = this.variantContainer.querySelectorAll('.variant-editor-row');
            allRows.forEach(row => row.classList.remove('drag-over'));
          }
        });
        
        // Drag over event for the row
        variantRow.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Only process if we have a dragged element
          if (!this.draggedElement || this.draggedIndex === index) return;
          
          // Add visual indicator
          variantRow.classList.add('drag-over');
          
          // Update the dragOverIndex
          this.dragOverIndex = index;
        });
        
        // Drag leave event
        variantRow.addEventListener('dragleave', () => {
          variantRow.classList.remove('drag-over');
        });
        
        // Drop event
        variantRow.addEventListener('drop', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // Only process if we have a dragged element
          if (!this.draggedElement || this.draggedIndex === index) return;
          
          // Remove visual indicator
          variantRow.classList.remove('drag-over');
          
          // Move the variant in the array
          const draggedVariant = this.variants[this.draggedIndex];
          
          // Remove the dragged variant
          this.variants.splice(this.draggedIndex, 1);
          
          // Insert at the new position
          this.variants.splice(index, 0, draggedVariant);
          
          // Update active index if needed
          if (this.activeVariantIndex === this.draggedIndex) {
            this.activeVariantIndex = index;
          } else if (this.activeVariantIndex > this.draggedIndex && this.activeVariantIndex <= index) {
            this.activeVariantIndex--;
          } else if (this.activeVariantIndex < this.draggedIndex && this.activeVariantIndex >= index) {
            this.activeVariantIndex++;
          }
          
          // Update lastNonEmptyVariantIndex if needed
          if (this.lastNonEmptyVariantIndex === this.draggedIndex) {
            this.lastNonEmptyVariantIndex = index;
          } else if (this.lastNonEmptyVariantIndex > this.draggedIndex && this.lastNonEmptyVariantIndex <= index) {
            this.lastNonEmptyVariantIndex--;
          } else if (this.lastNonEmptyVariantIndex < this.draggedIndex && this.lastNonEmptyVariantIndex >= index) {
            this.lastNonEmptyVariantIndex++;
          }
          
          // Re-render with the new order
          this.renderVariantInputs(this.activeVariantIndex);
          
          // Update the editor with the new order
          this.updateVariantsInEditor();
        });
      }
      
      // Input for the variant - placeholder text varies by index
      const placeholder = index === 0 ? 'Original text' : 
                         index === this.variants.length - 1 && variant.trim() === '' ? 'Add a variant' : 
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
        
        // If this is the last row and user starts typing, add a new empty row
        if (index === this.variants.length - 1 && variantInput.textContent && variantInput.textContent.trim() !== '') {
          // Debounce adding a new row to avoid adding multiple rows rapidly
          if (variantInput.dataset.addRowTimeout) {
            clearTimeout(parseInt(variantInput.dataset.addRowTimeout));
          }
          
          const addRowTimeoutId = setTimeout(() => {
            // Store the current active index (the one being typed in)
            const currentActiveIndex = this.activeVariantIndex;
            
            // Add a new empty variant row
            this.variants.push('');
            
            // Re-render but keep focus on the current row
            this.renderVariantInputs(currentActiveIndex);
          }, 300);
          
          variantInput.dataset.addRowTimeout = addRowTimeoutId.toString();
        }
        
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
      
      // Don't allow deleting the original variant or the empty "Add a variant" row
      const isEmptyAddVariantRow = index === this.variants.length - 1 && variant.trim() === '';
      if (index > 0 && !isEmptyAddVariantRow) {
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
          
          // Re-render the variant inputs with focus on the new active index
          this.renderVariantInputs(this.activeVariantIndex);
          
          // Update the editor content to reflect the deletion
          this.updateVariantsInEditor();
        });
      }
      
      // Focus logic - prioritize the specified focusIndex if provided
      const shouldFocus = 
        // If a specific index was provided to focus, focus that one
        (focusIndex !== undefined && index === focusIndex) ||
        // Otherwise, focus the last empty row only if no specific focus index was provided
        (focusIndex === undefined && variant === '' && index === this.variants.length - 1);
      
      if (shouldFocus) {
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
    
    // Notify the parent that the modal was closed without committing
    // We pass an explicit modalClosed=true flag to indicate this was triggered by modal closing
    this.onSubmit(this.variants[this.activeVariantIndex], this.activeVariantIndex, false, this.currentFrom, this.currentTo, true);
  }
}
