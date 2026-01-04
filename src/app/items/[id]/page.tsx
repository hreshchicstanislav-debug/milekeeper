import { notFound } from 'next/navigation';
import { listServiceItems, listLastServiceEventsForItems } from '@/lib/actions/serviceActions';
import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { estimateDailyKmRate } from '@/lib/service/odometerForecast';
import ItemDetailsPageClient from './ItemDetailsPageClient';

// Force dynamic rendering to ensure fresh data on every request
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function ItemDetailsPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab } = await searchParams;
  
  // Load all items to find the one we need
  const items = await listServiceItems();
  const item = items.find(i => i.id === id);
  
  if (!item) {
    notFound();
  }
  
  // Load parallel data
  const [latestOdometer, odometerEntries] = await Promise.all([
    getMaxMileageEntry(),
    listOdometerEntries(50),
  ]);
  
  // Get last event for this item
  const lastEventsMap = await listLastServiceEventsForItems([item.id]);
  const lastEvent = lastEventsMap[item.id] || null;
  
  // Compute forecast daily km rate
  const forecastResult = estimateDailyKmRate(odometerEntries);
  const forecastDailyKmRate = forecastResult.dailyKmRate;
  
  // Validate tab param
  const activeTab = tab === 'calc' ? 'calc' : 'history';
  
  return (
    <ItemDetailsPageClient
      item={item}
      latestOdometer={latestOdometer}
      lastEvent={lastEvent}
      dailyKmRate={forecastDailyKmRate}
      initialTab={activeTab}
    />
  );
}

