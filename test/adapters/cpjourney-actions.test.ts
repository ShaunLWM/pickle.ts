import { describe, expect, it, vi } from "vitest";
import { CpjourneyAdapter } from "../../src/adapters/cpjourney-adapter.js";

describe("CPJourney captured actions", () => {
  it("sends the captured igloo editor and store payloads", () => {
    const adapter = new CpjourneyAdapter();
    const send = vi.spyOn(adapter, "send").mockImplementation(() => {});
    const furniture = [
      {
        furnitureId: 1,
        x: 700,
        y: 643,
        rotation: 6,
        frame: 1,
        depth: 643,
      },
    ];

    adapter.getStoreMusic();
    adapter.buyMusic("1");
    adapter.getIglooStoreItems();
    adapter.buyFurniture("1", 1);
    adapter.updateIglooMusic("1");
    adapter.updateIglooFurniture(furniture);
    adapter.autoUpdateIglooFurniture(furniture);
    adapter.updateIglooType(0);
    adapter.openIgloo();
    adapter.closeIglooBounds();
    adapter.likeIgloo();
    adapter.openIglooEditor();
    adapter.closeIglooEditor();

    expect(send.mock.calls).toEqual([
      ["get_store_music", {}],
      ["add_music", { music: "1" }],
      ["get_igloostore_items", {}],
      ["add_furniture", { furniture: "1", amount: 1 }],
      ["update_music", { music: "1" }],
      ["update_furniture", { furniture }],
      ["update_furniture_auto", { furniture }],
      ["update_igloo", { type: 0 }],
      ["open_igloo", {}],
      ["close_igloo_bounds", {}],
      ["like_igloo", {}],
      ["igloo_editor_open", {}],
      ["igloo_editor_closed", {}],
    ]);
  });

  it("sends the captured puffle-care payloads", () => {
    const adapter = new CpjourneyAdapter();
    const send = vi.spyOn(adapter, "send").mockImplementation(() => {});

    adapter.getPuffles(7, true);
    adapter.getAllPuffles();
    adapter.getPuffleWellbeing(11);
    adapter.playPuffle(11);
    adapter.restPuffle(11);
    adapter.buyPuffleItem(11, 4);
    adapter.walkPuffle(11);
    adapter.initializePuffleTower();
    adapter.getBackyardSupplies();
    adapter.findBuddy(8);

    expect(send.mock.calls).toEqual([
      ["get_puffles", { userId: 7, isBackyard: true }],
      ["get_all_puffles", {}],
      ["get_wellbeing", { puffle: 11 }],
      ["puffle_play", { puffle: 11 }],
      ["update_puffle_rest", { puffle: 11 }],
      ["puffle_buy_item", { puffleId: 11, item: 4 }],
      ["walk_puffle", { puffle: 11 }],
      ["tower_init", {}],
      ["backyard_supplies", {}],
      ["buddy_find", { id: 8 }],
    ]);
  });
});
