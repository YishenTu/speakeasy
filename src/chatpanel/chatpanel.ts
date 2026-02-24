import { mountChatPanel } from './app/bootstrap';

if (window.top === window) {
  mountChatPanel();
}
