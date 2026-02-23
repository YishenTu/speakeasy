import { getComposerTemplate, getResizeZonesTemplate } from './template/composer-template';
import { getHistoryTemplate } from './template/history-template';
import { getImagePreviewTemplate } from './template/image-preview-template';
import { getShellTemplate } from './template/shell-template';
import { getChatPanelStyles } from './template/styles';

export function getChatPanelTemplate(brandLogoSrc = 'icons/gemini-logo.svg'): string {
  return `${getChatPanelStyles()}

    <div id="speakeasy-shell" class="shell" hidden>
      <section id="speakeasy-panel" class="panel">${getShellTemplate(brandLogoSrc)}

        <ol id="speakeasy-messages" class="messages"></ol>
${getImagePreviewTemplate()}
${getComposerTemplate()}
      </section>${getHistoryTemplate()}${getResizeZonesTemplate()}
    </div>
  `;
}
