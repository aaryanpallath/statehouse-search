import type { Meta, StoryObj } from '@storybook/react-vite';
import { ResultCard } from './ResultCard';
import { sampleResult } from './fixtures';

const meta: Meta<typeof ResultCard> = {
  title: 'Search/ResultCard',
  component: ResultCard,
  decorators: [(Story) => <ul className="result-list"><Story /></ul>],
};
export default meta;
type Story = StoryObj<typeof ResultCard>;

export const Hybrid: Story = { args: { result: sampleResult, href: '#' } };
export const SemanticOnly: Story = {
  args: { result: { ...sampleResult, ftsRank: null, vectorRank: 1, score: 0.016393, snippet: [{ text: 'Vegetation management near structures…', hit: false }] }, href: '#' },
};
export const KeywordOnly: Story = { args: { result: { ...sampleResult, vectorRank: null, score: 0.016393 }, href: '#' } };
