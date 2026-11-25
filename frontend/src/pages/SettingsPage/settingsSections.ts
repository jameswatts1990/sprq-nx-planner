/** Which Settings sections the sidebar lists. The developer-tools section exists only when the
 * deployment enables it (`dev_tools` from /api/settings/features) and the user has revealed it;
 * otherwise it is absent, so a `?section=developer` link falls back to the first section. */
export function visibleSections<S>(
  sections: S[],
  devSection: S,
  { devToolsEnabled, devShown }: { devToolsEnabled: boolean; devShown: boolean },
): S[] {
  return devToolsEnabled && devShown ? [...sections, devSection] : sections;
}
