import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Wordmark } from "@/components/brand/wordmark";
import { source } from "@/lib/source";

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    // The app's own next-themes provider already handles light/dark; Fumadocs follows the same `.dark` class.
    <RootProvider theme={{ enabled: false }} search={{ enabled: false }}>
      <DocsLayout
        tree={source.getPageTree()}
        nav={{ title: <Wordmark />, url: "/" }}
        links={[{ text: "Open app", url: "/app", active: "none" }]}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
