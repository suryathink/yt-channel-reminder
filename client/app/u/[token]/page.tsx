import LinkAction from '@/components/LinkAction';

export default async function PauseLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkAction token={token} />;
}
