import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SearchBar, type SearchFiltersValue } from './SearchBar';

const meta: Meta<typeof SearchBar> = { title: 'Search/SearchBar', component: SearchBar };
export default meta;
type Story = StoryObj<typeof SearchBar>;

const statuses = [
  { value: 'Introduced', count: 41 },
  { value: 'Amended Assembly', count: 88 },
  { value: 'Chaptered', count: 63 },
];

function Interactive(props: { initial: SearchFiltersValue; loading?: boolean; summary?: string }) {
  const [value, setValue] = useState(props.initial);
  return <SearchBar value={value} onChange={setValue} sessions={['20252026']} statuses={statuses} loading={props.loading} summary={props.summary} />;
}

const empty: SearchFiltersValue = { q: '', session: '', status: '', sponsor: '', subject: '' };

export const Empty: Story = { render: () => <Interactive initial={empty} /> };
export const WithQuery: Story = {
  render: () => <Interactive initial={{ ...empty, q: 'wildfire insurance', status: 'Chaptered' }} summary="12 results in 41 ms · hybrid (keyword + semantic, RRF)" />,
};
export const Loading: Story = { render: () => <Interactive initial={{ ...empty, q: 'tenant' }} loading /> };
