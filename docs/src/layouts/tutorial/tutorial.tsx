import { component$, Host, Slot, useHostElement, useScopedStyles$ } from '@builder.io/qwik';
import { useLocation } from '../../utils/useLocation';
import { Header } from '../../components/header/header';
import { SiteStore } from '../../main';
import { menuItems } from './tutorial-menu';
import { Repl } from '../../repl/repl';
import styles from './tutorial.css?inline';
import { TutorialContentFooter } from './tutorial-content-footer';
import { TutorialContentHeader } from './tutorial-content-header';
import { setHeadStyles } from '@builder.io/qwest';
import { TransformModuleInput } from '@builder.io/qwik/optimizer';

interface TutorialLayoutProps {
  store: SiteStore;
}

const Tutorial = component$(async (props: TutorialLayoutProps) => {
  useScopedStyles$(styles);

  const hostElm = useHostElement();
  setHeadStyles(hostElm, [
    {
      style: `html,body { margin: 0; height: 100%; overflow: hidden; }`,
    },
  ]);

  const loc = useLocation();
  const currentItem = menuItems.find((i) => i.path === loc.pathname);
  if (!currentItem) {
    return <div>Unable to find tutorial: {loc.pathname}</div>;
  }

  const replInputs: TransformModuleInput[] = [
    {
      path: `/main.tsx`,
      code: `
import { component$ } from '@builder.io/qwik';

export const Main = component$(() => {
  return (
    <div>Hello World</div>
  );
});
      `.trim(),
    },
    {
      path: `/entry.server.tsx`,
      code: `
import { renderToString, RenderToStringOptions, QwikLoader } from '@builder.io/qwik/server';
import { Main } from './main';

export function render(opts: RenderToStringOptions) {
  return renderToString(
    <html>
      <head>
        <title>Qwik Demo</title>
      </head>
      <body>
        <Main />
        <QwikLoader />
      </body>
    </html>,
    opts
  );
}
      `.trim(),
    },
  ];

  return (
    <Host class="tutorial">
      <Header store={props.store} />
      <main>
        <div class="content-panel">
          <TutorialContentHeader currentItem={currentItem} />
          <div class="content-main">
            <div>
              <Slot />
            </div>
          </div>
          <TutorialContentFooter currentItem={currentItem} />
        </div>
        <div class="repl-panel">
          <Repl inputs={replInputs} layout="narrow" />
        </div>
      </main>
    </Host>
  );
});

export default Tutorial;
