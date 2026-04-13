chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "GET_PAGE_DATA") {
      const pageData = {
        title: document.title,
        url: window.location.href,
        content: document.body.innerText.slice(0, 3000), // limit content
      };
  
      sendResponse(pageData);
    }
  });