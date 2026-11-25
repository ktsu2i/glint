import { Menu } from "@base-ui/react/menu";
import { CheckIcon, SortAscendingIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { librarySortOrders, type LibrarySortOrder } from "./librarySort";

type LibrarySortMenuProps = {
  order: LibrarySortOrder;
  onOrderChange: (order: LibrarySortOrder) => void;
};

// LibrarySortMenu chooses the order of the books on the shelf.
export function LibrarySortMenu({ order, onOrderChange }: LibrarySortMenuProps) {
  const { t } = useTranslation();
  const label = t("librarySort.open", { order: t(`librarySort.${order}`) });
  return (
    <Menu.Root>
      <Menu.Trigger className="glass-button" aria-label={label} title={label}>
        <SortAscendingIcon size={17} aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="book-menu-positioner" align="end" sideOffset={6}>
          <Menu.Popup className="book-menu glass">
            <Menu.RadioGroup
              value={order}
              onValueChange={(value: LibrarySortOrder) => onOrderChange(value)}
            >
              <Menu.GroupLabel className="book-menu-label">
                {t("librarySort.heading")}
              </Menu.GroupLabel>
              {librarySortOrders.map((value) => (
                <Menu.RadioItem key={value} value={value} className="book-menu-item">
                  <span className="book-menu-check" aria-hidden="true">
                    <Menu.RadioItemIndicator>
                      <CheckIcon size={13} weight="bold" />
                    </Menu.RadioItemIndicator>
                  </span>
                  {t(`librarySort.${value}`)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
