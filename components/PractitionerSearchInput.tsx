import { getTranslations } from "next-intl/server";

// A bare label + text input, name="q" — meant to be dropped into any
// <form method="get"> that should end up on /browse?q=... . Used inline
// in the browse page's filter form today; a future header search can
// reuse this same component without duplicating the label/markup.
export async function PractitionerSearchInput({
  defaultValue = "",
}: {
  defaultValue?: string;
}) {
  const t = await getTranslations("Search");

  return (
    <label>
      {t("label")}
      <br />
      {/* Submitted via the enclosing form's submit button, not on every
          keystroke — this is what currently satisfies "don't fire a query
          per keystroke." If this ever becomes a live/as-you-type search
          (e.g. the planned header search), add a ~300ms debounce before
          querying on change — the current submit-based form doesn't need
          one, but a live input would. */}
      <input type="text" name="q" defaultValue={defaultValue} />
    </label>
  );
}
