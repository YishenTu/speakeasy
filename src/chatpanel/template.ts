import { getComposerTemplate, getResizeZonesTemplate } from './template/composer-template';
import { getHistoryTemplate } from './template/history-template';
import { getShellTemplate } from './template/shell-template';
import { getChatPanelStyles } from './template/styles';

export function getChatPanelTemplate(): string {
  return `${getChatPanelStyles()}

    <div id="speakeasy-shell" class="shell" hidden>
      <section id="speakeasy-panel" class="panel">${getShellTemplate()}

        <ol id="speakeasy-messages" class="messages"></ol>
${getComposerTemplate()}
      </section>${getHistoryTemplate()}${getResizeZonesTemplate()}
    </div>
  `;
}
