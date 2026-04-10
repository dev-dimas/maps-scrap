export const SELECTORS = {
  name: '//h1[contains(@class,"DUwDvf")]',

  address:
    '//button[@data-item-id="address"]//div[contains(@class,"fontBodyMedium")]',

  website:
    '//a[@data-item-id="authority"]//div[contains(@class,"fontBodyMedium")]',

  phone:
    '//button[contains(@data-item-id,"phone:tel:")]//div[contains(@class,"fontBodyMedium")]',

  reviewsAvg: '//span[contains(@class,"MW4etd")]',

  reviewsCount:
    '//span[@aria-label[contains(.,"reviews") or contains(.,"ulasan") or contains(.,"Reviews")]]',

  serviceOptions: '//div[contains(@class,"LTs0Rc")]',

  placeType: '//button[contains(@class,"DkEaL")]',

  intro: '//div[contains(@class,"PYvSYb")]',

  listings: '//a[contains(@class,"hfpxzc")]',
} as const;
