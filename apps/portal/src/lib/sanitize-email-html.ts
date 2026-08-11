/**
 * Email HTML is provider data, never application markup. Keep the allowlist
 * deliberately small and remove executable/external-resource behavior.
 */
export function sanitizeEmailHtml(input: string): string {
  if (typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(input, "text/html");
  for (const element of Array.from(document.body.querySelectorAll("script,style,iframe,object,embed,form,link,meta,base"))) {
    element.remove();
  }
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "style" || name === "src" || name === "srcset") {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "href" && !/^(https?:|mailto:)/i.test(attribute.value.trim())) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return document.body.innerHTML;
}
