/** Public pages live under /p/[slug], whose layout draws the header (with the campaign's network). */
export default function PublicLayout({ children }: LayoutProps<"/p">) {
  return children;
}
