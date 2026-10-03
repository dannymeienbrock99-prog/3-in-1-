package de.crazybatto.touchdeck;
public class DeckAddressTest {
 public static void main(String[] ignored) {
  String[][] good={{"192.168.1.10","http://192.168.1.10:17660/"},{"http://10.0.0.2:17670/","http://10.0.0.2:17670/"},{"172.31.255.254:80","http://172.31.255.254:80/"}};
  for(String[] item:good)if(!item[1].equals(DeckAddress.normalize(item[0])))throw new AssertionError(item[0]);
  String[] bad={"","https://192.168.1.1","8.8.8.8","127.0.0.1","10.0.0.300","172.15.2.1","172.32.2.1","192.168.01.1","http://name@192.168.1.1","192.168.1.1:0","192.168.1.1:70000","192.168.1.1/path","192.168.1.1/?pin=123456","192.168.1.1/#a","file:///etc/passwd","192.168.1.1.evil.test","2130706433","[::1]"};
  for(String item:bad)if(DeckAddress.normalize(item)!=null)throw new AssertionError("Accepted: "+item);
  if(!DeckAddress.sameOrigin(good[0][1],"http://192.168.1.10:17660/api/state"))throw new AssertionError("own origin");
  for(String item:new String[]{"http://192.168.1.10:17661/","http://192.168.1.11:17660/","https://192.168.1.10:17660/","file:///etc/passwd","http://a@192.168.1.10:17660/"})if(DeckAddress.sameOrigin(good[0][1],item))throw new AssertionError("Cross origin: "+item);
  String link="batto-touch://connect?url=http%3A%2F%2F192.168.1.10%3A17660%2F&pin=123456";
  if(!"http://192.168.1.10:17660/#pin=123456".equals(DeckAddress.fromAppLink(link)))throw new AssertionError("QR app link");
  if(!"http://10.0.0.2:17670/".equals(DeckAddress.fromAppLink("batto-touch://connect?url=http%3A%2F%2F10.0.0.2%3A17670%2F")))throw new AssertionError("App link without PIN");
  String[] invalidLinks={null,"https://connect?url=http%3A%2F%2F10.0.0.2","batto-touch://other?url=http%3A%2F%2F10.0.0.2",link+"&pin=999999",link+"&other=x",link+"#invalid",link.replace("pin=123456","pin=123"),link.replace("192.168.1.10","8.8.8.8"),"batto-touch://connect?url=javascript%3Aalert(1)",link.replace("connect?","connect:123?"),link.replace("connect?","user@connect?"),link.replace("connect?","connect/elsewhere?")};
  for(String item:invalidLinks)if(DeckAddress.fromAppLink(item)!=null)throw new AssertionError("Accepted app link: "+item);
  System.out.println("DeckAddress: 41 address/origin/app-link checks passed");
 }
}
