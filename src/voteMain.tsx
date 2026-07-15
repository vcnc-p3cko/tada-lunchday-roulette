import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import '../assets/vote.css';

import { Theme } from '@astryxdesign/core';
import { ToastViewport } from '@astryxdesign/core/Toast';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { createRoot } from 'react-dom/client';

import { VoteApp } from './VoteApp';

const container = document.getElementById('voteRoot');
if (container) {
  createRoot(container).render(
    <Theme theme={neutralTheme} mode="light">
      <ToastViewport position="bottomEnd" maxVisible={3}>
        <VoteApp />
      </ToastViewport>
    </Theme>
  );
}
