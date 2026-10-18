import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnnotationPanel } from './AnnotationPanel';
import { sampleAnnotations } from './fixtures';

const meta: Meta<typeof AnnotationPanel> = {
  title: 'Bill/AnnotationPanel',
  component: AnnotationPanel,
  decorators: [(Story) => <div style={{ width: 340 }}><Story /></div>],
};
export default meta;
type Story = StoryObj<typeof AnnotationPanel>;

const handlers = { onAuthorChange: () => {}, onCreate: () => {}, onDelete: () => {}, onFocus: () => {} };

export const WithReanchoredNotes: Story = {
  args: { ...handlers, annotations: sampleAnnotations, selection: null, author: 'Sam', connected: true, peers: 2 },
};
export const WithSelection: Story = {
  args: {
    ...handlers,
    annotations: sampleAnnotations.slice(0, 1),
    selection: { start: 27, end: 52, quote: 'emergency regulations on or before' },
    author: 'Sam',
    connected: true,
    peers: 1,
  },
};
export const Offline: Story = { args: { ...handlers, annotations: [], selection: null, author: '', connected: false, peers: 0 } };
