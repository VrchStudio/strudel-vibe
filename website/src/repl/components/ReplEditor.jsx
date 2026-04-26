import Loader from '@src/repl/components/Loader';
import { HorizontalPanel, VerticalPanel } from '@src/repl/components/panel/Panel';
import { Code } from '@src/repl/components/Code';
import UserFacingErrorMessage from '@src/repl/components/UserFacingErrorMessage';
import { Header } from './Header';
import { useSettings } from '@src/settings.mjs';
import { BackgroundFrame } from './BackgroundFrame';
import { MidiSliderController } from '../midiSliderControl.jsx';

// type Props = {
//  context: replcontext,
// }

export default function ReplEditor(Props) {
  const { context, ...editorProps } = Props;
  const { containerRef, editorRef, error, init, pending } = context;
  const settings = useSettings();
  const { panelPosition } = settings;

  return (
    <div className="h-full flex flex-col relative" {...editorProps}>
      <MidiSliderController />
      <BackgroundFrame />
      <Loader active={pending} />
      <Header context={context} />
      <div className="grow flex relative overflow-hidden">
        <Code containerRef={containerRef} editorRef={editorRef} init={init} />
        {panelPosition === 'right' && <VerticalPanel context={context} />}
      </div>
      <UserFacingErrorMessage error={error} />
      {panelPosition === 'bottom' && <HorizontalPanel context={context} />}
    </div>
  );
}
