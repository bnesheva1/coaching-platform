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
      <input type="text" name="q" defaultValue={defaultValue} />
    </label>
  );
}
