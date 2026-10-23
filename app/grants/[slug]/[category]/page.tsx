import { SeoLanding } from '../../landing';
import { pageData, segmentMetadata } from '../../seo-data';

// /grants/<state>/<category>
export const dynamic = 'force-dynamic';
type Params = Promise<{ slug: string; category: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug, category } = await params;
  return segmentMetadata([slug, category]);
}

export default async function StateCategoryPage({ params }: { params: Params }) {
  const { slug, category } = await params;
  const { site, page, content } = await pageData([slug, category]);
  return <SeoLanding site={site} page={page} content={content} />;
}
