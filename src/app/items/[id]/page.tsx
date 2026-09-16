import { notFound } from 'next/navigation';
import { listServiceItems, listLastServiceEventsForItems } from '@/lib/actions/serviceActions';
import { getMaxMileageEntry, listOdometerEntries } from '@/lib/actions/odometerActions';
import { calculateDailyMileageRateToBe } from '@/lib/service/dailyMileageRateToBe';
import { computeEstimatedOdometer } from '@/lib/service/estimatedOdometer';
import ItemDetailsPageClient from './ItemDetailsPageClient';
import { getAppNow } from '@/lib/appNow';

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
    getMaxMileageEntry(`ItemDetails:${item.title}`),
    listOdometerEntries(50),
  ]);
  
  // Get last event for this item
  const lastEventsMap = await listLastServiceEventsForItems([item.id]);
  const lastEvent = lastEventsMap[item.id] || null;
  
  // TO-BE: single canonical now + TO-BE daily mileage rate
  const appNow = getAppNow();
  const dailyRateResult = calculateDailyMileageRateToBe(odometerEntries, appNow);
  const forecastDailyKmRate = dailyRateResult.dailyRate; // number | null

  // Forecasts run on the estimated current odometer, not on the raw last reading
  const estimatedOdometer = computeEstimatedOdometer(latestOdometer, forecastDailyKmRate, appNow);

  // Validate tab param
  const activeTab = tab === 'calc' ? 'calc' : 'history';
  
  return (
    <ItemDetailsPageClient
      item={item}
      latestOdometer={latestOdometer}
      estimatedOdometer={estimatedOdometer}
      lastEvent={lastEvent}
      dailyKmRate={forecastDailyKmRate}
      initialTab={activeTab}
    />
  );
}

