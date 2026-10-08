import { headers } from 'next/headers';
import { createCopy } from './copy';
import { callbackLocale, LOCALE_HEADER } from './routing';
export async function getCopy() { return createCopy(callbackLocale((await headers()).get(LOCALE_HEADER))); }
