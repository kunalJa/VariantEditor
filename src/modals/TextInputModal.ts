import { App, Modal, Setting } from 'obsidian';

/**
 * Modal for text input that appears after highlighting
 */
export class TextInputModal extends Modal {
  private inputText: string = '';
  private onSubmit: (result: string) => void;

  constructor(app: App, onSubmit: (result: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen() {
    const {contentEl} = this;
    
    contentEl.createEl('h2', {text: 'Enter text to insert'});
    
    // Create text area for input
    const textArea = contentEl.createEl('textarea', {
      attr: {
        placeholder: 'Type your text here...',
        rows: '6',
      },
      cls: 'variant-editor-textarea'
    });
    
    textArea.addEventListener('input', (e) => {
      this.inputText = (e.target as HTMLTextAreaElement).value;
    });
    
    // Focus the textarea
    setTimeout(() => textArea.focus(), 10);
    
    // Add buttons
    new Setting(contentEl)
      .addButton(btn => btn
        .setButtonText('Cancel')
        .onClick(() => this.close())
      )
      .addButton(btn => btn
        .setButtonText('Insert')
        .setCta()
        .onClick(() => {
          this.close();
          this.onSubmit(this.inputText);
        })
      );
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
