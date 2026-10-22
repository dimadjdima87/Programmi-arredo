import "./style.css";
export const metadata = {
  title: "Albertelli | Design Studio DEMO",
  description: "Prototipo di progettazione cucina e moodboard",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
