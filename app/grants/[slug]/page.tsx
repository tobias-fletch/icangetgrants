import { SeoLanding } from '../landing';
import { pageData, segmentMetadata } from '../seo-data';

// /grants/<state> or /grants/<category>; unknown slugs and pages with 0 open listings return 404.
export const dynamic = 'force-dynamic';
type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  return segmentMetadata([slug]);
}

export default async function StateOrCategoryPage({ params }: { params: Params }) {
  const { slug } = await params;
  const { site, page, content } = await pageData([slug]);
  return <SeoLanding site={site} page={page} content={content} />;
}
