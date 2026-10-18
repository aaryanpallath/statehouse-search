import type { Meta, StoryObj } from '@storybook/react-vite';
import { DiffView } from './DiffView';
import { sampleDiff } from './fixtures';

const meta: Meta<typeof DiffView> = { title: 'Bill/DiffView', component: DiffView };
export default meta;
type Story = StoryObj<typeof DiffView>;

const args = {
  segments: sampleDiff.segments,
  rows: sampleDiff.rows,
  stats: { insertedWords: 4, deletedWords: 3, unchangedWords: 13 },
  fromLabel: 'Introduced (2025-01-06)',
  toLabel: 'Amended Senate (2025-03-12)',
};
export const SideBySide: Story = { args };
export const Inline: Story = { args: { ...args, initialMode: 'inline' } };
