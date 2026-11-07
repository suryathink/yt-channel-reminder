import LinkAction from '@/components/LinkAction';

export default async function WatchedLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkAction token={token} />;
}
