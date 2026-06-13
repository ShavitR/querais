/** Inject a JSON-LD structured-data block (server component, static). */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify output is safe to inline as ld+json.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
